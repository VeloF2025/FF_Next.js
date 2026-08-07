<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Vehicle tracking services

Two ingestion paths, both landing in `fleet_vehicle_positions` via `ingest.ts`:

| Path | Cadence | Endpoint | Providers |
|---|---|---|---|
| REST API | 2 min | `/api/cron/poll-tracking` | Cartrack (Velocity account) |
| Portal scrape | 2 hours | `/api/cron/poll-portal-tracking` | Netstar |

## Gotchas

- **`ingest.ts` is provider-blind.** Never add provider-specific logic to it.
- **Positions for unmapped trackers are silently dropped** (`skippedUnmapped`). A vehicle with
  no `fleet_vehicle_trackers` row can never receive data — run discovery first.
- **Netstar live data comes from the TREE API, not reports.** One POST to
  `/Main/VehicleRepo/GetVehicleTreeDataPaging` returns every vehicle on the account WITH its
  last fix. **POST only** — the same path answers 404 to a GET — and it needs
  `X-Requested-With: XMLHttpRequest`. Verified against the live portal 2026-08-07:
  11,454 leaves, all with usable positions.
- **A dead feed cannot be detected by an empty result.** A snapshot provider returns the same
  stale fix forever, so `positions.length === 0` never fires. Use `client.feedFreshness()` —
  newest fix across the WHOLE reseller account — and alert past `STALE_FEED_MS`.
- **Two portal rows matching one of our plates refuse BOTH.** First-past-the-post would let a
  stranger's re-issued plate win, and misattribution is unrepairable (dedup key has no vehicle id).
- **`granularity` on `TrackingProvider`** says whether `fetchPositions` means history or a
  snapshot. Cartrack is `'history'`, Netstar `'snapshot'`. They are not substitutable.
- **`fetchPositions` is a SNAPSHOT, `fetchHistory` is the report/CSV flow** (in `netstar/history.ts`). The snapshot
  returns at most one fix per vehicle; `from`/`to` filter it, they do not fetch history. Only
  `scripts/backfill-tracking.ts` uses `fetchHistory`, and that path is UNVERIFIED against the
  live portal — it was documented in the same pass that had the vehicle list pointing at
  `/Reports/ReportRepo/GetReportTree`, which 404s.
- **Netstar caps reports at 31 days.** `chunkWindow()` in `netstar/client.ts` enforces it, for
  the history path only.
- **Netstar enforces a single session.** A human logging into the portal logs this job out;
  `PortalSession` re-authenticates once, then gives up rather than looping.
- **Netstar's account is a multi-client reseller tree.** Only request mapped vehicles.
- **Discovery never takes a vehicle off another provider.** `setVehicleTracker` deactivates by
  `vehicle_id` alone, with no provider predicate — mapping a Cartrack-tracked vehicle silently
  kills its 2-minute feed. `loadTrackedElsewhere` filters those out.
- **Ambiguous registration matches are refused, not resolved.** A position written against the
  wrong vehicle is permanent: the dedup key has no `vehicle_id`, so a corrected re-insert
  collides and is dropped.
- **A partial fetch must not advance the watermark.** One vehicle's failed report is isolated
  (`PartialFetchError`), but the window was not fully covered for it.
- **Alert on discovery health, not position volume.** `fetchPositions` reads already-mapped
  trackers, so a portal list that suddenly matches nothing looks exactly like a healthy tick.
- Full reference: `.claude/modules/fleet.md`, spec in `docs/superpowers/specs/2026-08-05-portal-tracker-ingestion-design.md`.
