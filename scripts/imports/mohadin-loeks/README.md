# Mohadin — Loeks Ellis field-sheet import

Field-captured property↔DR↔ONT serial mappings for the **Mohadin** project (`PRJ-1761242661257`), sourced from the Loeks Ellis Google Drive folder [`1e8NBEirNd1W8WHruuRhrSoPcN8NCRUpX`](https://drive.google.com/drive/folders/1e8NBEirNd1W8WHruuRhrSoPcN8NCRUpX), PONs 17–32.

## Why this exists

In Mohadin PONs 17–32 the `drops` table is missing `ont_serial` on ~1,000 rows. The Loeks sheets contain the missing serials, plus signals we don't currently capture: pre-provisioned (installed but not activated) ONTs, MAIN HOUSE / BACK ROOM dwelling labels, and notes like "DR NEEDED" / "TO BE ACTIVATED" / "SWAP ONT SN AND DR STICKERS".

## Workflow (stage + review, never writes drops directly)

1. **Snapshot** the Drive sheets (one-off; requires Claude with Drive MCP access). Snapshots live in `data/pon-NN.md`. To refresh, replace the `.md` files — sheet IDs are in `import.ts`.
2. **Migration** — run `scripts/migrations/sql/347_loeks_field_mapping_staging.sql` to create the staging table (or `npm run db:migrate`).
3. **Import**

   ```bash
   DATABASE_URL=postgresql://… tsx scripts/imports/mohadin-loeks/import.ts          # parse → stage → classify
   DATABASE_URL=postgresql://… tsx scripts/imports/mohadin-loeks/import.ts --dry    # parse + counts only
   ```

4. **Review** — `psql "$DATABASE_URL" -f scripts/imports/mohadin-loeks/reconcile.sql`

   Key categories:

   | match_status | Meaning |
   |---|---|
   | `new_fill` | DR exists in `drops` with empty `ont_serial`; sheet has a serial. **Safe to apply.** |
   | `already_set` | DB matches sheet. No action. |
   | `conflict` | DB has a different serial than the sheet. **Manual review required.** |
   | `dr_not_found` | DR formatted correctly but absent from `drops` (typo or wrong PON). |
   | `pre_provision` | ONT serial captured but no DR — installed not activated. |
   | `serial_orphan` | ONT serial with no DR and no activation flag. |
   | `needs_dr` | Installer wrote "DR NEEDED" / "ACTIVATION NEEDED". |
   | `invalid_serial` | Serial fails the ALCLB+hex format check (suggests data-entry typo). |
   | `property_only` | Row has only a property number — no install data captured. |
   | `no_dr_no_serial` | Empty row. |

5. **Apply** the `new_fill` rows by uncommenting the `BEGIN … COMMIT` block at the bottom of `reconcile.sql`. The block writes `ont_serial` and appends a provenance line to `drops.notes` (this is where the MAIN HOUSE / BACK ROOM disambiguation lands).

## Refreshing snapshots when sheets change

The Drive sheets are live-edited by Loeks (new PONs added, existing rows corrected). Until we automate this, the refresh process is:

1. In a Claude session with Drive MCP authenticated, pull each `PON N` sheet from folder [`1e8NBEirNd1W8WHruuRhrSoPcN8NCRUpX`](https://drive.google.com/drive/folders/1e8NBEirNd1W8WHruuRhrSoPcN8NCRUpX) and overwrite the matching `data/pon-NN.md`.
2. Re-run `import.ts`. The staging table is rebuilt from scratch (`TRUNCATE + INSERT`) and reclassified.
3. Re-eyeball `new_fill` rows and re-run the apply block in `reconcile.sql`.

### Planned: service-account fetch + cron (follow-up PR)

Eventually replace the manual snapshot step with `scripts/imports/mohadin-loeks/fetch.ts` — a Node script using a read-only Google service account to list the folder, auto-discover any new `PON N` sheets, and write the same `data/pon-NN.md` files. Then run nightly via systemd timer. Two prerequisites before turning this on:

- Switch `import.ts` from `TRUNCATE + INSERT` to `UPSERT by (source_sheet_id, source_row_index)` so `apply_status` / `applied_at` survive reloads.
- Decide what to do when a row that was `applied` last sync changes upstream (probably: re-classify as `conflict` and require re-review).

## Known data-quality patterns

- Typos: `DAR1856348`, `MAINJ HOUSE`, `BACKM ROOM`, `DR18556048`, duplicated `DR1854880 DR1854880` — handled by lenient parsing + classification into `dr_not_found` / `invalid_serial`.
- Cross-PON misfilings: e.g. PON 25 row noting "THIS DR AND ONT SN IS IN PON 38" — captured into `cross_pon_hint`.
- Property numbers like `10994/9`, `10994/42` — sub-divided complex, kept as-is.
- GPS coordinates like `21.19571'N, 72.8084'E` appear on a few rows — those coords are in India, **not** the Mohadin site (Potchefstroom). Treat the GPS column as unreliable.
