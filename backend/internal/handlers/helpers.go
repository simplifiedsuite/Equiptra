package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"equiptra/internal/storage"
)

type API struct {
	DB *pgxpool.Pool
	// Supabase is nil when the product-photo feature is disabled
	// (SUPABASE_PROJECT_REF/SUPABASE_SERVICE_ROLE_KEY unset) — see
	// storage.NewSupabaseClient.
	Supabase *storage.SupabaseClient
}

// dbExecutor is satisfied by both *pgxpool.Pool and pgx.Tx — lets shared
// query helpers (recomputeBookingRequestStatus, findAllocationConflicts,
// etc.) run either directly against the pool or inside an explicit
// transaction, e.g. the rack/case checkout cascade, which needs the
// container's own checkout and its contents' cascaded allocations to commit
// or roll back together.
type dbExecutor interface {
	Exec(ctx context.Context, sql string, arguments ...interface{}) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func readJSON(r *http.Request, v interface{}) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}
