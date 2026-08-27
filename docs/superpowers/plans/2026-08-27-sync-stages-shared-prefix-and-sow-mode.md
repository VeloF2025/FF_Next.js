# sync-stages: shared 1Map prefixes + SOW-only stage tracking (2026-08-27)

Follow-up to the QA Centre tree (#2636): `pon_stage_tracking` only covers projects with a
unique `metadata.onemap_prefix` (Lawley, Mamelodi, Mohadin). Johan's list is mostly absent.

## Facts (verified against prod DB 2026-08-27)
- `syncSite()` attributes 1Map records via the project's own `drops.drop_number` lookup; records
  that don't map are skipped (`unmapped++; continue`). So running it once per project over a
  shared site's records is safe. TEM: 4,467 DRs → Thembisa POP 1, 712 → POP 3, 0 overlap.
- Scope (poles/joints/drops totals), poles planted (QField `poles` + OES), CWC, activation
  (OES) all come from DB queries, not 1Map. Only the permissions stage uses 1Map records.
- Etwatwa: ETW is already swept (3,310 DRs match) — project just lacks the prefix.
- Themb'elihle: zero 1Map presence; has 1,808 poles / 1,673 joints / 3,749 drops.
- Thembisa POP 2 is `status='planning'` — excluded by discoverProjects' `status='active'`; leave.

## Decisions (Hein 2026-08-27)
1. A prefix may map to N projects; `syncSite` runs per project.
2. New `metadata.stage_tracking = 'sow'` → project is synced with `records = []` (totals +
   DB-derived stages only; permissions stays 0).
3. Data changes (separate step, Hein runs/approves — live prod DB):
   `UPDATE projects SET metadata = coalesce(metadata,'{}') || '{"onemap_prefix":"TEM"}' WHERE project_name IN ('Thembisa POP 1','Thembisa POP 3');`
   `… || '{"onemap_prefix":"ETW"}' WHERE project_name='Etwatwa';`
   `… || '{"stage_tracking":"sow"}' WHERE project_name='Themb''elihle';`

## Module shape (scripts/sync-stages.mjs — keep file <300 lines: extract if needed)
- `discoverProjects(pool, filterPrefixes)` → returns `{ byPrefix: Map<prefix, project[]>, sowOnly: project[] }`.
  Query: `status='active' AND (metadata->>'onemap_prefix' IS NOT NULL OR metadata->>'stage_tracking'='sow')`.
  Guard: a project with BOTH prefix and sow flag is synced once, via the prefix path.
- `main()`: for each site code, after `upsertProperties`, `for (const p of byPrefix.get(site) ?? []) syncSite(site, p.uuid, pool, p.name, records)`.
  Remove the "no unique project" skip. Log `${site}: stage tracking for N projects`.
  After the site loop: `for (const p of sowOnly) syncSite('SOW', p.uuid, pool, p.name, [])`.
  `stagedProjects` counts every successful syncSite.
- `syncSite` must tolerate `records=[]` (check `parsed`, `permittedDRs.size>0` guard already exists; verify nothing divides by/derefs records length).
- Update header comment (lines 1-12, 29-31) to describe shared prefixes + sow mode.

## Tests (scripts/__tests__/sync-stages-discovery.test.ts, model on onemap-property-sync.test.ts)
- Export the pure grouping helper (e.g. `groupProjects(rows)`) and test: shared prefix → two
  entries under one key; sow-only row → sowOnly; row with both → prefix path only; prefix
  filter respects CLI args. Mutation-test each branch.
- If `scripts/__tests__` runs under the unit vitest config, confirm the new file is picked up.

## Validation
1. `npx vitest run scripts/__tests__/sync-stages-discovery.test.ts`; eslint on changed files; `npm run ci:quick`.
2. Dry run against prod DB read path is not possible without 1Map creds locally; after merge +
   prod deploy, run the cron's own command once from `/home/velo/fibreflow-production` (read-only
   use of the deploy dir) or wait for the 4-hourly tick, then:
   `select p.project_name, count(*), max(last_synced_at) from pon_stage_tracking t join projects p on p.id=t.project_id group by 1;`
   Expect Thembisa POP 1 (~267 PONs), POP 3 (~322), Etwatwa (~179), Themb'elihle (~54) with fresh timestamps.
3. QA Centre tree on prod shows the new projects; Etwatwa's zone-25 rows survive the upsert.

## Not building
- POP2 / Herotel / Wumatel (need SOW imports first; they'll appear by flagging `stage_tracking='sow'`).
- Any change to the tree UI or to Tracker.
