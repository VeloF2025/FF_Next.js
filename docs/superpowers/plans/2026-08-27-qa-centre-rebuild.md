# QA Centre Rebuild — Project → Zone → PON (2026-08-27)

Source: Johan Scott walkthrough, meeting 289774. Spec artifact: https://claude.ai/code/artifact/94881e93-7800-41ec-9095-33df6079adca

## Decisions (grilled, Hein 2026-08-27)
- "Pond" = PON (`pon_stage_tracking` row per project/zone_no/pon_no).
- No new schema. Read-only view over existing tables.
- Zone status: `Maintenance` iff active (non-superseded) `zone_delivery_documents` rows exist for BOTH `fac` and `cac`; else `WIP`.
- PON status: `Optical Submitted` iff `pon_delivery_state.port_submitted_at IS NOT NULL`; that timestamp is the submission-date column; else `WIP`.
- Counts per row: `poles_total`, `poles_planted`, `activation_total`, `activation_complete` from `pon_stage_tracking`; zone row = SUM over its PONs.
- Replaces `ConstructionQaCentrePage` content (not `/activate/qa-centre`, which is DR review).

## Module shape
- `pages/api/construction-qa/delivery-tree.ts` — `GET ?projectId=&opticalSubmittedOnly=1`. One SQL: pon_stage_tracking LEFT JOIN pon_delivery_state (via pon_stage_id) + zone doc flags subquery. Returns `{ projects:[{ id,name, zones:[{ zone_no,status,counts, pons:[{ pon_no,status,counts,opticalSubmittedAt }] }] }] }`.
- `src/modules/construction-qa/delivery-tree/` — `deriveStatus.ts` (pure fns, unit-tested), `useDeliveryTree.ts`, `DeliveryTreePage.tsx` (<200 lines: project/zone/pon expandable rows), `DeliveryTreeFilter.tsx`.
- Wire `ConstructionQaCentrePage` route to new page.

## Tasks (DAG)
1. Pre-check (SQL, read-only): counts of ponds with `port_submitted_at` set, zones with fac+cac active. If ~0, flag to Hein before UI.
2. `deriveStatus.ts` + vitest (zone: fac only → WIP; fac+cac superseded → WIP; both active → Maintenance. pon: null → WIP; date → Optical Submitted). Mutation-test the guard.
3. API route + integration test against real PG fixture (vitest unit exclude per memory).
4. UI page + filter + date column; Playwriter screenshot both themes on dev.
5. Blind `/review`, CI green, PR.

## Validation
- API returns correct tree for a known project (compare one zone by hand against `pon-stages.ts` output).
- Filter with `opticalSubmittedOnly` returns only PONs with a date, across all projects and single project.
- Browser-verified on dev.fibreflow.app.

## Not building
- Editing status from this page. Herotel/Wumatel site grouping beyond the project filter. Any write path.

## Task 1 result (prod, 2026-08-27)
553 PONs; 16 with `port_submitted_at`; 4 zones with active fac+cac (11 zone docs total). Signals exist but are sparse — view will be mostly WIP until Zone Delivery is used more. Proceed.
