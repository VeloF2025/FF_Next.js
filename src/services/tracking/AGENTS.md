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
- **Netstar caps reports at 31 days.** `chunkWindow()` in `netstar/client.ts` enforces it.
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
