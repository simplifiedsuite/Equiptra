"""
Equiptra — CurrentRMS container-relationship extraction script.

Pulls serialized container->contents relationships (racks/cases and what's
currently packed in them) out of CurrentRMS via their API before the
account gets shut down, and saves them locally so the data isn't lost.
Does NOT write anything into Equiptra — this is the "don't lose the data"
step only, matching extract_photos.py's approach for photos. Mapping into
Equiptra's schema is a separate, later step.

Field shapes were confirmed against real live data before writing this
(see chat), not assumed from CurrentRMS's docs, which don't spell out the
container fields precisely:

  - The relationship lives entirely on the `stock_level` resource (the
    serialized asset), not on the product. Two fields matter:
      - container_stock_level_id (nullable int): if set, THIS stock_level
        is currently packed inside the stock_level with that id.
      - container_mode (nullable int: null/0/1 seen): UNRELIABLE — do not
        use this as an "is this a container" flag. Of 66 stock_levels
        confirmed (structurally) to actually be containers, 65 have
        container_mode=0 (identical to thousands of ordinary non-container
        items) and only 1 has it set to 1. It looks like a rarely-used UI
        toggle, not consistent data.
  - The only reliable way to know "is X a container" is relational: does
    any OTHER stock_level's container_stock_level_id point at X's id.
    This means a container that is CURRENTLY EMPTY (nothing packed in it
    right now) is indistinguishable from an ordinary non-container item in
    this data — there is no way to detect an empty container from the API.
    Flagged explicitly in the output summary printed at the end.
  - This is a current-state pointer only — no per-job/booking scoping, no
    history. It answers "what's in what right now", not "what was packed
    for which job".

Usage:
    pip install requests
    python3 extract_containers.py

You'll need the same CurrentRMS API key/subdomain as extract_photos.py
(System Setup > Integrations > API).
"""

import csv
import json
import os
import time
import requests

# ---- CONFIGURE THESE ----
API_KEY = "XLhVpGtfWgeqDDoF71va"
SUBDOMAIN = "ldmtv"
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
# --------------------------

BASE_URL = "https://api.current-rms.com/api/v1"
HEADERS = {
    "X-AUTH-TOKEN": API_KEY,
    "X-SUBDOMAIN": SUBDOMAIN,
    "Content-Type": "application/json",
}


def fetch_all_stock_levels():
    """Paginate through every stock_level in the account (serialized and
    bulk alike — the container fields only apply to serialized items, but
    we fetch everything so bulk stock is visible in the raw dump too)."""
    all_levels = []
    page = 1
    while True:
        resp = requests.get(
            f"{BASE_URL}/stock_levels",
            headers=HEADERS,
            params={"per_page": 100, "page": page},
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
        levels = data.get("stock_levels", [])
        all_levels.extend(levels)
        total = data.get("meta", {}).get("total_row_count", 0)
        print(f"  fetched page {page}: {len(levels)} rows ({len(all_levels)}/{total} so far)")
        if not levels or len(all_levels) >= total:
            break
        page += 1
        time.sleep(0.2)  # be polite to their API
    return all_levels


def main():
    print("Fetching every stock_level from CurrentRMS...")
    all_levels = fetch_all_stock_levels()
    print(f"Done — {len(all_levels)} stock_levels fetched.\n")

    by_id = {sl["id"]: sl for sl in all_levels}

    # A content row is anything currently pointing at a container.
    content_rows = [sl for sl in all_levels if sl.get("container_stock_level_id") is not None]
    container_ids = sorted(set(sl["container_stock_level_id"] for sl in content_rows))

    # --- Raw JSON backup: full CurrentRMS records for every container and
    # every item currently packed in one — maximum fidelity, in case
    # anything is needed later that the CSV doesn't carry. ---
    raw_path = os.path.join(OUTPUT_DIR, "container_relationships_raw.json")
    raw_payload = {
        "containers": [by_id[cid] for cid in container_ids if cid in by_id],
        "contents": content_rows,
        "extracted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(raw_path, "w", encoding="utf-8") as f:
        json.dump(raw_payload, f, indent=2)
    print(f"Wrote raw JSON backup: {raw_path}")

    # --- Relationship CSV: one row per (container, content) pair, keyed by
    # CurrentRMS stock_level id (= assets.legacy_id in Equiptra) on both
    # sides, plus asset_number for a human-readable cross-check. ---
    csv_path = os.path.join(OUTPUT_DIR, "container_relationships.csv")
    missing_container_ids = []
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "container_stock_level_id",
            "container_asset_number",
            "container_item_id",
            "container_item_name",
            "content_stock_level_id",
            "content_asset_number",
            "content_serial_number",
            "content_item_id",
            "content_item_name",
        ])
        for sl in content_rows:
            container = by_id.get(sl["container_stock_level_id"])
            if container is None:
                # Points at a stock_level not present in this fetch (e.g.
                # inactive/archived, or paging inconsistency) — flag rather
                # than silently dropping the row.
                missing_container_ids.append((sl["id"], sl["container_stock_level_id"]))
                container_asset_number = ""
                container_item_id = ""
                container_item_name = "UNKNOWN — container not found in fetched data"
            else:
                container_asset_number = container.get("asset_number", "")
                container_item_id = container.get("item_id", "")
                container_item_name = container.get("item_name", "")
            writer.writerow([
                sl["container_stock_level_id"],
                container_asset_number,
                container_item_id,
                container_item_name,
                sl["id"],
                sl.get("asset_number", ""),
                sl.get("serial_number", ""),
                sl.get("item_id", ""),
                sl.get("item_name", ""),
            ])
    print(f"Wrote relationship CSV: {csv_path}")

    # --- Container-only summary CSV: one row per distinct container, with
    # a content count — useful for a quick "does this match what I expect"
    # sanity check without wading through 400+ relationship rows. ---
    summary_path = os.path.join(OUTPUT_DIR, "containers_summary.csv")
    counts = {}
    for sl in content_rows:
        counts[sl["container_stock_level_id"]] = counts.get(sl["container_stock_level_id"], 0) + 1
    with open(summary_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["container_stock_level_id", "container_asset_number", "container_item_name", "content_count"])
        for cid in container_ids:
            container = by_id.get(cid)
            writer.writerow([
                cid,
                container.get("asset_number", "") if container else "",
                container.get("item_name", "") if container else "UNKNOWN",
                counts.get(cid, 0),
            ])
    print(f"Wrote container summary CSV: {summary_path}")

    print("\n=== SUMMARY ===")
    print(f"Total stock_levels fetched:                {len(all_levels)}")
    print(f"Distinct containers found (structurally):  {len(container_ids)}")
    print(f"Items currently packed in a container:      {len(content_rows)}")
    if missing_container_ids:
        print(f"WARNING: {len(missing_container_ids)} content row(s) point at a container_stock_level_id not found in this fetch:")
        for content_id, missing_cid in missing_container_ids:
            print(f"    content stock_level {content_id} -> missing container {missing_cid}")
    print()
    print("NOTE: this only captures containers that currently have at least")
    print("one item packed in them. CurrentRMS has no reliable 'is_container'")
    print("flag (container_mode is inconsistent — see script docstring), so")
    print("a container that is currently EMPTY cannot be detected from this")
    print("data at all. If any known racks/cases are empty right now, they")
    print("will be missing from this extraction and need flagging manually.")


if __name__ == "__main__":
    main()
