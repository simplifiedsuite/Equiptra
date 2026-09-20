package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"equiptra/internal/db"
	"equiptra/internal/handlers"
	"equiptra/internal/middleware"
	"equiptra/internal/notify"
	"equiptra/internal/storage"
)

func main() {
	ctx := context.Background()

	pool, err := db.Connect(ctx)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer pool.Close()

	supabaseClient := storage.NewSupabaseClient()
	if supabaseClient == nil {
		log.Printf("SUPABASE_PROJECT_REF/SUPABASE_SERVICE_ROLE_KEY not set — product photo uploads are disabled")
	}

	notifyClient := notify.NewClient()
	if notifyClient == nil {
		log.Printf("SENDGRID_API_KEY not set — password-reset emails are disabled")
	}

	api := &handlers.API{DB: pool, Supabase: supabaseClient, Notify: notifyClient}

	r := chi.NewRouter()
	r.Use(chimiddleware.Logger)
	r.Use(chimiddleware.Recoverer)
	r.Use(chimiddleware.Timeout(30 * time.Second))

	// FRONTEND_ORIGIN accepts a comma-separated list (mirroring Ralto's own
	// FRONTEND_ORIGINS) now that Equiptra is reachable from two origins at
	// once: its original equiptra-smoky.vercel.app URL, and the new
	// equipment.simplifiedsuite.io custom domain the Core SSO bridge
	// requires (the suite_session cookie is scoped to .simplifiedsuite.io
	// and is never sent to a vercel.app origin).
	frontendOrigins := splitOrigins(os.Getenv("FRONTEND_ORIGIN"))
	if len(frontendOrigins) == 0 {
		frontendOrigins = []string{"http://localhost:5173"}
	}
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   frontendOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type"},
		AllowCredentials: true,
	}))

	// Stage 2 SSO handoff (additive — see BridgeCoreSession's own comment).
	// A no-op for every request unless CORE_API_URL is set and the request
	// carries a suite_session cookie with no equiptra_session yet.
	r.Use(api.BridgeCoreSession)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	r.Post("/api/auth/login", api.Login)
	r.Post("/api/auth/logout", api.Logout)

	// Self-service password reset — public/unauthenticated, same tier as
	// login above. forgot-password is rate-limited tighter than login:
	// each request can trigger a real outbound email to an address the
	// caller chooses, not just a failed login attempt against their own,
	// so it's worth capping harder against being used to mail-bomb someone
	// else's inbox from this app (see Ralto's own identical reasoning).
	r.With(middleware.RateLimit(6, time.Minute)).Post("/api/auth/forgot-password", api.RequestPasswordReset)
	r.With(middleware.RateLimit(20, time.Minute)).Post("/api/auth/reset-password", api.ConfirmPasswordReset)

	// Public fault-report form: reachable by freelancers with no Equiptra
	// account, so it sits outside RequireAuth. OptionalAuth still injects
	// claims when a staff member happens to have a session, so the handler
	// can auto-fill the reporter rather than asking them to re-type it.
	// Rate-limited since it's an open write (and read) surface on the
	// public internet, not gated by auth at all.
	r.Route("/api/public", func(r chi.Router) {
		r.Use(middleware.RateLimit(20, time.Minute))
		r.Use(middleware.OptionalAuth)
		r.Get("/assets", api.SearchPublicAssets)
		r.Post("/fault-reports", api.CreateFaultReport)
	})

	r.Route("/api", func(r chi.Router) {
		r.Use(middleware.RequireAuth)
		r.Use(middleware.RequirePasswordSet)

		r.Get("/me", api.Me)

		r.Route("/products", func(r chi.Router) {
			r.Get("/", api.ListProducts)
			r.Get("/{id}", api.GetProduct)
			r.Get("/{id}/assets", api.ListProductAssets)
			// Create/edit intentionally open to any authenticated user for now
			// (admin vs standard permissions still TBD — see README). Delete and
			// photo upload stay admin-gated since they weren't part of that ask.
			r.Post("/", api.CreateProduct)
			r.Put("/{id}", api.UpdateProduct)
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireAdmin)
				r.Delete("/{id}", api.DeleteProduct)
				r.Post("/{id}/photo", api.UploadProductPhoto)
			})
		})

		r.Route("/assets", func(r chi.Router) {
			r.Get("/", api.ListAssets)
			r.Get("/{id}", api.GetAsset)
			r.Get("/{id}/history", api.GetAssetHistory)
			r.Get("/{id}/rack-members", api.ListRackMembers)
			// Unlike products, editing an existing asset covers fields like
			// asset_number/status that are closer to value-editing than
			// day-to-day booking — admin-gated, same as delete. Create stays
			// open to any authenticated user.
			r.Post("/", api.CreateAsset)
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireAdmin)
				r.Put("/{id}", api.UpdateAsset)
				r.Delete("/{id}", api.DeleteAsset)
				// Rack membership is permanent kit structure, same access
				// tier as the asset-edit screen — see
				// docs/equiptra-racks-cases-addendum.md.
				r.Post("/{id}/swap-rack-member", api.SwapRackMember)
				r.Post("/{id}/members", api.AddRackMember)
				r.Delete("/{id}/members/{assetId}", api.RemoveRackMember)
			})
		})

		r.Route("/projects", func(r chi.Router) {
			r.Get("/", api.ListProjects)
			r.Post("/", api.CreateProject)
			r.Get("/{id}", api.GetProject)
			r.Put("/{id}", api.UpdateProject)
			r.Delete("/{id}", api.DeleteProject)
			r.Post("/{id}/status", api.UpdateProjectStatus)
			r.Get("/{id}/carnet", api.GetCarnetView)
			r.Get("/{id}/carnet/export.csv", api.ExportCarnetCSV)
			r.Get("/{id}/carnet/export.pdf", api.ExportCarnetPDF)
			r.Get("/{id}/delivery-note", api.GetDeliveryNoteView)
			r.Get("/{id}/delivery-note/export.pdf", api.ExportDeliveryNotePDF)
		})

		r.Route("/monday", func(r chi.Router) {
			// Same access level as project creation — read-only, no reason
			// to restrict further. Proxies to Core's own Monday.com
			// connection now — see MondayProjectLookup's own comment.
			r.Get("/project-lookup", api.MondayProjectLookup)
		})

		// Job Fetch-from-Monday, Stage B — same pattern as Crewing's own
		// Stage A, proxying straight to Core, which owns the real Client/
		// Contract records. See core_proxy.go.
		r.Get("/core-clients", api.ListCoreClients)
		r.Post("/core-clients", api.CreateCoreClient)
		r.Get("/core-contracts", api.ListCoreContracts)

		// Vehicle kit tracking (Stage 2 of the shared Vehicle addendum) —
		// backs the asset-edit screen's Core Vehicle picker. See
		// migrations/0010_vehicle_kit_tracking.sql.
		r.Get("/core-vehicles", api.ListCoreVehicles)

		// Shared Core Job entity — one Monday fetch, visible from every
		// product. See Core's own migrations/0008_jobs.sql.
		r.Get("/core-jobs", api.GetCoreJobByOrderNumber)
		r.Post("/core-jobs", api.CreateCoreJob)
		r.Post("/core-jobs/{id}/refresh", api.RefreshCoreJob)

		r.Route("/booking-requests", func(r chi.Router) {
			r.Get("/", api.ListBookingRequests)
			r.Post("/", api.CreateBookingRequest)
			r.Get("/{id}", api.GetBookingRequest)
			r.Put("/{id}", api.UpdateBookingRequest)
			r.Delete("/{id}", api.DeleteBookingRequest)
			r.Post("/{id}/cancel", api.CancelBookingRequest)
			r.Get("/{id}/allocations", api.ListAllocationsForRequest)
			r.Post("/{id}/allocations", api.CreateAllocation)
		})

		// Contract-level defaults — a starting-point kit/equipment template
		// applied to a new Project's booking_requests. See
		// internal/handlers/contract_defaults.go.
		r.Route("/contract-defaults", func(r chi.Router) {
			r.Get("/contracts", api.ListContractsWithDefaults)
			r.Get("/", api.ListContractDefaults)
			r.Post("/", api.UpsertContractDefault)
			r.Delete("/{id}", api.DeleteContractDefault)
		})

		r.Route("/booking-allocations", func(r chi.Router) {
			r.Delete("/{id}", api.DeleteAllocation)
			r.Post("/{id}/checkout", api.CheckoutAllocation)
			r.Post("/{id}/checkin", api.CheckinAllocation)
			r.Post("/{id}/return-to-home-rack", api.MarkReturnedToHomeRack)
			// Case packing is per-job pack-out work, same access tier as
			// picking a specific asset for a booking (CreateAllocation) —
			// see docs/equiptra-racks-cases-addendum.md.
			r.Get("/{id}/case-contents", api.ListCaseContents)
			r.Post("/{id}/case-contents", api.AddCaseContent)
			r.Delete("/{id}/case-contents/{contentAssetId}", api.RemoveCaseContent)
			r.Post("/{id}/case-contents/swap", api.SwapCaseContent)
		})

		r.Route("/service-records", func(r chi.Router) {
			r.Get("/", api.ListServiceRecords)
			r.Get("/{id}", api.GetServiceRecord)
			// Creation happens via check-in damage (CheckinAllocation) or the
			// public fault-report form (/api/public/fault-reports) — not here.
			r.Put("/{id}", api.UpdateServiceRecord)
		})

		// Account/login management is more sensitive than products/assets, so
		// unlike those this resource stays admin-only — except changing your
		// own password, which any authenticated user (including a
		// must_change_password-restricted session) can do.
		r.Route("/users", func(r chi.Router) {
			r.Patch("/me/password", api.ChangeOwnPassword)

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireAdmin)
				r.Get("/", api.ListUsers)
				r.Post("/", api.CreateUser)
				r.Patch("/{id}", api.UpdateUser)
				r.Patch("/{id}/password", api.AdminResetPassword)
				r.Delete("/{id}", api.DeleteUser)
			})
		})
	})

	// Render, Fly, and most PaaS platforms inject PORT and require the app
	// to bind to it; LISTEN_ADDR (full host:port) still wins if set, for
	// local dev / anywhere PORT isn't the convention.
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		if port := os.Getenv("PORT"); port != "" {
			addr = ":" + port
		} else {
			addr = ":8080"
		}
	}
	log.Printf("equiptra api listening on %s", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatal(err)
	}
}

func splitOrigins(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	return origins
}
