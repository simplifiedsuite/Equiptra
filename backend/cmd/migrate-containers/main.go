// Command migrate-containers maps the CurrentRMS container relationships
// extracted by "Container Extraction/extract_containers.py"
// (container_relationships.csv) onto Equiptra's existing racks/cases model
// (assets.container_type, assets.home_rack_id — see
// backend/migrations/0005_racks_cases.sql). Does not touch case_contents:
// that table is booking_allocation-scoped and CurrentRMS's data carries no
// job history behind a case's current pack-list, so there's nowhere valid
// to attach it — see Ric's instruction in chat.
//
// The rack/case split is final, agreed with Ric directly (not re-derived
// or guessed): 9 specific container_stock_level_ids are racks (their
// current contents get home_rack_id set), every other container in the CSV
// is a case (container_type set on the container only, no content writes).
//
// Matching key: container_stock_level_id / content_stock_level_id ->
// assets.legacy_id — same join as the opportunity importer
// (cmd/migrate-opportunities). Every container and every content asset is
// checked against assets.legacy_id regardless of rack/case classification;
// unmatched ones are flagged and counted, never silently skipped, even for
// cases where nothing would be written for that row anyway.
//
// Idempotent by construction: this only ever sets container_type/
// home_rack_id to the same final values, so re-running is harmless.
// Use -dry-run to preview counts without writing.
package main

import (
	"context"
	"encoding/csv"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"equiptra/internal/db"
)

// rackContainerIDs is the final rack/case categorization agreed with Ric —
// see package doc comment. Every other container_stock_level_id present in
// the CSV is treated as a case.
var rackContainerIDs = map[int64]bool{
	675:  true, // T16 LDM / "Scanner"
	774:  true, // Audio Rack (12u)
	783:  true, // CCU Rack (12u)
	851:  true, // T16 TSV / "Tender"
	1055: true, // Studio Flight Case (16U)
	1478: true, // T16 Rack
	1938: true, // Rugby Rack
	1948: true, // NEW V16 LDM
	1955: true, // Core Rack
}

type relationshipRow struct {
	containerStockLevelID int64
	containerAssetNumber  string
	containerItemName     string
	contentStockLevelID   int64
	contentAssetNumber    string
	contentItemName       string
}

func readCSV(path string) ([]relationshipRow, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	rows, err := csv.NewReader(f).ReadAll()
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("%s is empty", path)
	}
	header := rows[0]
	colIdx := make(map[string]int, len(header))
	for i, h := range header {
		colIdx[h] = i
	}

	var out []relationshipRow
	for _, row := range rows[1:] {
		var r relationshipRow
		if _, err := fmt.Sscanf(row[colIdx["container_stock_level_id"]], "%d", &r.containerStockLevelID); err != nil {
			return nil, fmt.Errorf("bad container_stock_level_id %q: %w", row[colIdx["container_stock_level_id"]], err)
		}
		if _, err := fmt.Sscanf(row[colIdx["content_stock_level_id"]], "%d", &r.contentStockLevelID); err != nil {
			return nil, fmt.Errorf("bad content_stock_level_id %q: %w", row[colIdx["content_stock_level_id"]], err)
		}
		r.containerAssetNumber = row[colIdx["container_asset_number"]]
		r.containerItemName = row[colIdx["container_item_name"]]
		r.contentAssetNumber = row[colIdx["content_asset_number"]]
		r.contentItemName = row[colIdx["content_item_name"]]
		out = append(out, r)
	}
	return out, nil
}

func lookupAssetID(ctx context.Context, pool *pgxpool.Pool, legacyID int64) (int64, bool, error) {
	var assetID int64
	err := pool.QueryRow(ctx, `SELECT id FROM assets WHERE legacy_id = $1`, legacyID).Scan(&assetID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return assetID, true, nil
}

func main() {
	csvPath := flag.String("csv", "../../../Container Extraction/container_relationships.csv", "path to the extracted container_relationships.csv")
	dryRun := flag.Bool("dry-run", false, "preview counts without writing to the database")
	flag.Parse()

	rows, err := readCSV(*csvPath)
	if err != nil {
		log.Fatalf("reading %s: %v", *csvPath, err)
	}
	log.Printf("read %d relationship rows from %s", len(rows), *csvPath)

	ctx := context.Background()
	pool, err := db.Connect(ctx)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer pool.Close()

	// Group rows by container, preserving a stable, sorted iteration order
	// for readable logs.
	byContainer := map[int64][]relationshipRow{}
	var containerIDs []int64
	for _, r := range rows {
		if _, ok := byContainer[r.containerStockLevelID]; !ok {
			containerIDs = append(containerIDs, r.containerStockLevelID)
		}
		byContainer[r.containerStockLevelID] = append(byContainer[r.containerStockLevelID], r)
	}
	sort.Slice(containerIDs, func(i, j int) bool { return containerIDs[i] < containerIDs[j] })

	var (
		racksSet, casesSet                     int
		homeRackIDsSet                         int
		containersUnmatched, contentsUnmatched []string
	)

	for _, cid := range containerIDs {
		group := byContainer[cid]
		isRack := rackContainerIDs[cid]
		kind := "case"
		if isRack {
			kind = "rack"
		}

		containerAssetID, ok, err := lookupAssetID(ctx, pool, cid)
		if err != nil {
			log.Fatalf("looking up container legacy_id=%d: %v", cid, err)
		}
		if !ok {
			msg := fmt.Sprintf("container legacy_id=%d (asset_number=%s, %q) has NO matching assets.legacy_id — FLAGGED, skipped entirely (%d content rows under it also unprocessed)",
				cid, group[0].containerAssetNumber, group[0].containerItemName, len(group))
			log.Printf("%s", msg)
			containersUnmatched = append(containersUnmatched, msg)
			continue
		}

		log.Printf("container legacy_id=%d asset_id=%d (%s, %q) -> container_type=%s, %d content row(s)",
			cid, containerAssetID, group[0].containerAssetNumber, group[0].containerItemName, kind, len(group))

		if !*dryRun {
			if _, err := pool.Exec(ctx, `UPDATE assets SET container_type = $1, updated_at = now() WHERE id = $2`, kind, containerAssetID); err != nil {
				log.Fatalf("setting container_type on asset %d: %v", containerAssetID, err)
			}
		}
		if isRack {
			racksSet++
		} else {
			casesSet++
		}

		// Every content asset is checked against assets.legacy_id regardless
		// of rack/case — cases just never get a write from this, per Ric's
		// instruction not to touch case_contents.
		for _, r := range group {
			contentAssetID, ok, err := lookupAssetID(ctx, pool, r.contentStockLevelID)
			if err != nil {
				log.Fatalf("looking up content legacy_id=%d: %v", r.contentStockLevelID, err)
			}
			if !ok {
				msg := fmt.Sprintf("content legacy_id=%d (asset_number=%s, %q) under container legacy_id=%d has NO matching assets.legacy_id — FLAGGED, skipped",
					r.contentStockLevelID, r.contentAssetNumber, r.contentItemName, cid)
				log.Printf("    %s", msg)
				contentsUnmatched = append(contentsUnmatched, msg)
				continue
			}
			if !isRack {
				continue // case: container_type already set above, no per-content write
			}
			if !*dryRun {
				if _, err := pool.Exec(ctx, `UPDATE assets SET home_rack_id = $1, updated_at = now() WHERE id = $2`, containerAssetID, contentAssetID); err != nil {
					log.Fatalf("setting home_rack_id on asset %d: %v", contentAssetID, err)
				}
			}
			homeRackIDsSet++
		}
	}

	log.Printf("")
	log.Printf("=== SUMMARY ===")
	log.Printf("containers processed:              %d (racks=%d, cases=%d)", racksSet+casesSet, racksSet, casesSet)
	log.Printf("home_rack_id set on content assets: %d", homeRackIDsSet)
	log.Printf("containers with NO assets.legacy_id match: %d", len(containersUnmatched))
	for _, m := range containersUnmatched {
		log.Printf("    %s", m)
	}
	log.Printf("content assets with NO assets.legacy_id match: %d", len(contentsUnmatched))
	for _, m := range contentsUnmatched {
		log.Printf("    %s", m)
	}
	if *dryRun {
		log.Printf("")
		log.Printf("DRY RUN — nothing was written")
	}
}
