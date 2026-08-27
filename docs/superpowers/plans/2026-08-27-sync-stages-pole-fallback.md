# sync-stages: pole counts from `poles` when drops carry no pole link (2026-08-27)

## Problem (verified prod 2026-08-27)
`syncSite` derives pole scope (`poles_total`) from `COUNT(DISTINCT drops.pole_number)` and poles planted /
CWC from `drops LEFT JOIN poles ON pole_number`. For Thembisa POP 1, POP 3 and Themb'elihle every
`drops.pole_number` is NULL → 0 / 0 / 0, although `poles` has the data keyed by `zone_no, pon_no`:
POP 1 2,816 poles / 354 planted (3 unkeyed), POP 3 4,608 / 122 (12 unkeyed), Themb'elihle 1,808 / 0 (140 unkeyed).

`poles` OVER-counts for linked projects (Lawley: 4,937 in `poles` vs 2,994 via drops) — so this must be a
per-project switch, never a per-PON blend. Lawley/Mamelodi/Mohadin/Etwatwa output must be byte-identical.

## Design
In `syncSite` (scripts/sync-stages.mjs), after `polesTotalResult`:
- `const dropsLinkPoles = sum(row.poles)`; `const usePolesTable = dropsLinkPoles === 0 && ponMap.size > 0`.
- When `usePolesTable`: one query
  `SELECT zone_no, pon_no, COUNT(DISTINCT pole_number)::int poles,
          COUNT(DISTINCT CASE WHEN pole_planted='Pole Planted' THEN pole_number END)::int planted,
          COUNT(DISTINCT CASE WHEN audit_complete IS NOT NULL THEN pole_number END)::int cwc,
          MIN(audit_complete)::text cwc_first, MAX(audit_complete)::text cwc_last
   FROM poles WHERE project_id=$1 AND zone_no IS NOT NULL AND pon_no IS NOT NULL GROUP BY zone_no, pon_no`
  and for each row with an existing `ponMap` key: set `permissions.total`, `poles.total`, `cwc.total` = poles;
  `poles.complete` = planted; `cwc.complete/firstDate/lastDate` from cwc. Keys absent from ponMap (PON has
  poles but no drops) are skipped, same as the joints pattern.
- The later `dbStagesResult` loop only assigns `poles.complete` when `planted > 0` and `cwc` when `> 0`, so
  with the drops link empty it leaves the fallback values intact — verify by reading; do not restructure it.
  OES-implied "planted" (activation without pole link) is lost for these projects — acceptable, note in log.
- Log `  ${site}: pole counts from poles table (drops carry no pole link)` when the fallback engages.
- Extract the pure merge (`applyPoleFallback(ponMap, rows)`) into `scripts/lib/sync-stages-poles.mjs` and unit-test it
  (`scripts/__tests__/sync-stages-poles.test.ts`): sets totals+planted+cwc; skips unknown keys; leaves
  untouched when rows empty; and a `shouldUsePolesTable(rows)` helper: false when any drops row has poles>0.
  Mutation-test each branch. Keep sync-stages.mjs from growing more than needed (it is already >300, pre-existing).

## Validation
1. vitest new file; eslint changed files (3 pre-existing `process` no-undef in sync-stages.mjs are known); `npm run ci:quick`.
2. After merge + prod deploy (after hours, Hein approval), run as velo from /home/velo/fibreflow-production:
   `sudo -u velo bash -c 'cd /home/velo/fibreflow-production && node scripts/sync-stages.mjs TEM SOW LAW'`
   Expect: POP 1 poles_total ≈2,813 / planted 354; POP 3 ≈4,596 / 122; Themb'elihle ≈1,668 / 0;
   Lawley UNCHANGED (2,994 / 1,997). Query:
   `select p.project_name,sum(poles_total),sum(poles_planted),sum(cwc_complete) from pon_stage_tracking t join projects p on p.id=t.project_id group by 1;`
