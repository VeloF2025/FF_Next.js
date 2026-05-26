# Sprint C — Holder / Party Model — Design

**Date:** 2026-05-26
**Status:** Approved design (brainstorm complete). Next: implementation plan (`writing-plans`).
**Owner:** Hein
**Module:** Procurement / Field Stock
**Branch / worktree:** `feat/ff-holder-party-model` @ `/home/hein/Workspace/FF_Next.js-ff-holder-party-model` (off `origin/master` `2e11e938e`)
**Roadmap parent:** `docs/superpowers/specs/2026-05-25-stock-locations-custody-roadmap-design.md` (sub-project **C**)

---

## Purpose

A thin, typed **custody-identity registry** (`stock_holders`) that gives custody and
accountability a **single FK** to point at. This is the prerequisite seam for sub-project **D**
(the technician rethink). C deliberately ships *only* the registry, a resolver service, a
backfill of the existing holders, and one dual-write hook to keep the registry live. It does
**not** rebuild accountability, rewire serials, or touch any UI — those are D.

---

## Findings (verified against the live shared DB, 2026-05-26)

- **`stock_holders` is net-new** — referenced nowhere in code or DB outside the roadmap doc.
- **The 5 current "holders" are all `staff`.** `stock_locations` has 5 `location_type='technician'`
  rows; every one's `assigned_to_id` resolves to `staff.id` (Lindani Malembe, Byron Viviers,
  Marchael Meyer, Cecelia Serekoeng, Adriaan Paulse) — none to `contractors` or the (empty)
  `technicians` table.
- **`getOrCreateTechnicianLocation(technicianId, name, phone)`**
  (`src/modules/procurement/field-stock/services/locationService.ts`) mints a virtual
  `stock_locations` row (`is_virtual=true`, `code='TECH-' + id[:8]`, `assigned_to_id=technicianId`)
  on the Neon shim. The `technicianId` it is called with is a `staff.id`.
- **Accountability is dormant and contractor-keyed.** `contractor_stock_accountability`
  (keyed `contractor_id`, denormalised `contractor_name`, with `is_blocked`/recovery columns)
  is **empty**; `stock_accountability_history` likewise. The `/api/procurement/field-stock/
  accountability/[contractorId]/*` surface reads it on the Neon shim. No live data to preserve.
- **SMME is genuinely unrepresented.** All 10 `contractors` are `business_type='pty_ltd'`;
  there is **no** `contractor_type` / `company_type` column. Internal/external/SMME classification
  is net-new.
- **`staff.employment_type` is uniformly `'permanent'`** (NOT NULL default) — useless as an
  internal/external signal; `contract_type` carries a few `independent_contractor`/`contractor`
  values but is noisy.
- **Two team concepts exist** (`teams`+`team_members`, and `contractor_teams`).
- Next migration version is **383** (`SELECT MAX(version) FROM migrations` = 382, Sprint A);
  no open migration PRs (collision check clean).

---

## Decisions

### Holder taxonomy — 3 entity types, SMME is *not* a holder type
`holder_type ∈ {'staff', 'contractor', 'external_person'}`.
- `staff` — internal employee (the 5 today). Backed by `staff_id`.
- `contractor` — an organisation in `contractors`. Backed by `contractor_id`.
- `external_person` — a person with **no** other table (e.g. a freelance installer). Stored
  inline in `stock_holders` (name/phone/email), no FK.

**SMME is an attribute, not an identity.** Custody mechanics (who physically holds stock, what
they owe back) do not depend on a B-BBEE classification. If SMME reporting is needed later it
becomes a `contractor_class` attribute on `contractors` — **out of scope for C** (nothing
consumes it yet; YAGNI).

### Typed nullable FKs, not a polymorphic `ref_id`
The roadmap proposed a polymorphic `ref_id` resolved per `holder_type`. That cannot enforce
referential integrity. Instead: explicit nullable `staff_id` / `contractor_id` FKs plus a CHECK
that the populated FK matches `holder_type`. The DB then guarantees a `staff` holder really
points at a real staff row, etc.

### Teams never hold
A team is an abstraction over people; custody always lands on a named person
(`staff` / `external_person`) or a contractor org. No `team` holder_type. Teams remain a
routing/reporting concept handled outside custody.

### Dual-write to keep the registry live in the C→D gap
`getOrCreateTechnicianLocation` will, in addition to creating the technician location, upsert the
corresponding `staff` holder (via the resolver). This keeps `stock_holders` from going stale
between C and D, and reduces D's cutover to "read custody from holders". The location-creation
logic itself is unchanged in C (D removes it).

### Block / accountability state stays out of the registry
`stock_holders` carries `is_active` (registry lifecycle) only — **no** `blocked` column.
Blocking is a consequence of unaccounted custody, which D computes; the existing
`contractor_stock_accountability.is_blocked` already owns block-state. Adding `blocked` to the
identity row now would fork the source of truth. D rebuilds accountability as rollups keyed by
holder and decides where block-state lives then.

---

## Schema — `stock_holders` (migration 383, `stock_holders`)

```sql
CREATE TABLE stock_holders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_type   text NOT NULL,                       -- 'staff' | 'contractor' | 'external_person'
  staff_id      uuid REFERENCES staff(id),
  contractor_id uuid REFERENCES contractors(id),
  name          text NOT NULL,                        -- denormalised display name (self-describing)
  phone         text,
  email         text,
  is_active     boolean NOT NULL DEFAULT true,
  notes         text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT stock_holders_type_chk CHECK (holder_type IN ('staff','contractor','external_person')),
  CONSTRAINT stock_holders_ref_chk CHECK (
       (holder_type = 'staff'           AND staff_id IS NOT NULL AND contractor_id IS NULL)
    OR (holder_type = 'contractor'      AND contractor_id IS NOT NULL AND staff_id IS NULL)
    OR (holder_type = 'external_person' AND staff_id IS NULL AND contractor_id IS NULL)
  )
);

-- one holder per person / org
CREATE UNIQUE INDEX stock_holders_staff_uk
  ON stock_holders (staff_id)      WHERE holder_type = 'staff';
CREATE UNIQUE INDEX stock_holders_contractor_uk
  ON stock_holders (contractor_id) WHERE holder_type = 'contractor';
```

- `external_person` has no natural DB key; the resolver dedups on normalised `(lower(name), phone)`.
- `name`/`phone` are a cached copy for `staff`/`contractor` holders (matches the existing
  `stock_locations.assigned_to_name` denorm pattern); refreshed on backfill and dual-write. They
  may drift between refreshes — acceptable for a display field, not used as a key.
- A matching `rollback_383_stock_holders.sql` drops the table + indexes.

---

## Resolver service

`src/modules/procurement/field-stock/services/stockHolderService.ts` — **pg.Pool** via
`@/lib/db` / `@/lib/db-pool` (not the Neon shim). Contract:

```ts
getOrCreateStaffHolder(staffId: string, name?: string, phone?: string): Promise<StockHolder>
getOrCreateContractorHolder(contractorId: string, name?: string): Promise<StockHolder>
getOrCreateExternalHolder(name: string, phone?: string, email?: string): Promise<StockHolder>
getHolderById(id: string): Promise<StockHolder | null>
```

- get-or-create is idempotent against the partial unique indexes (staff/contractor) and the
  normalised name+phone match (external).
- When `name`/`phone` are passed and differ from the stored copy, refresh them (keeps denorm fresh).
- Keep the file < 300 lines; split if needed.

---

## Dual-write hook

In `getOrCreateTechnicianLocation` (`locationService.ts`), after the location is
created/fetched, call `getOrCreateStaffHolder(technicianId, technicianName, technicianPhone)`.
Failure of the holder upsert must **not** break location creation (log + continue) — the holder
registry is supplementary in C; D makes it authoritative.

---

## Backfill — `scripts/backfill-stock-holders.ts`

- For each `stock_locations` row with `location_type='technician'`, ensure a `staff` holder
  (`holder_type='staff'`, `staff_id = assigned_to_id`, `name = assigned_to_name`,
  `phone = assigned_to_phone`). 5 rows today, all staff.
- **Idempotent** upsert via `stock_holders_staff_uk`.
- **Dry-run by default**, `--commit` to write, with a row-level log of each holder created/skipped
  (per `feedback_run_backfills_through_verification_first`) — even though this is dev-data and 5 rows.
- tsx-script conventions (per Sprint A): `dotenv.config()` then **dynamically import** anything
  pulling `@/lib/db-pool`; use `process.stdout`/`stderr` (not `@/lib/logger`, silent under Node;
  `console.*` is lint-banned); end with `process.exit(0)`.

---

## Out of scope (named, owned by D unless noted)

- `blocked` / accountability rebuild — D (rollups keyed by holder).
- Rewiring `getOrCreateTechnicianLocation` to stop creating `technician` locations, and
  deactivating the existing 5 — D.
- The `/api/procurement/field-stock/accountability/[contractorId]/*` surface and
  `contractor_stock_accountability` re-keying — D.
- Serial `current_location_id` → holder semantics — D.
- `team` holder type — decided out (teams never hold).
- SMME `contractor_class` column on `contractors` — future procurement attribute; nothing
  consumes it yet.
- Any UI — none in C.

---

## Validation gates

- **Backfill:** after `--commit`, exactly **5** `stock_holders`, all `holder_type='staff'`, one
  per distinct technician-location `assigned_to_id`; re-running `--commit` is a **no-op**
  (0 created, 5 skipped).
- **Integrity (negative test):** inserting a `contractor` holder with a `staff_id`, or a `staff`
  holder with both FKs null, is rejected by `stock_holders_ref_chk`.
- **Resolver:** `getOrCreate*` called twice returns the same holder id (idempotency unit tests for
  all three types, incl. external name+phone dedup); name/phone refresh on changed input.
- **Dual-write:** creating a new technician location yields exactly one matching `staff` holder;
  a forced holder-upsert failure does not break location creation.
- **Build/lint:** `tsc --noEmit` clean; `npm run ci:quick` clean (no new errors; warnings within
  the 185 ratchet).

---

## Risks & mitigations

- **Denormalised name drift** (low) — display-only, refreshed on backfill/dual-write; never a key.
- **`assigned_to_id` not a staff row** (low) — all 5 verified to be staff today; the backfill
  logs and skips any technician location whose `assigned_to_id` is null or not a staff row rather
  than creating an integrity-violating holder. (If a non-staff technician location ever appears,
  it surfaces in the log for a human decision — it is not silently dropped.)
- **Parallel migration version collision** (low) — re-confirm `SELECT MAX(version)` and run
  `gh pr list --search 'migration in:title'` immediately before opening the PR
  (per `feedback_parallel_session_migration_coordination`).

---

## Acceptance (C is done when)

The registry exists with enforced integrity, the 5 existing holders are backfilled and deduped,
new technician locations auto-register their staff holder, the resolver is unit-tested, and
`tsc --noEmit` + `ci:quick` are clean — leaving D a clean `stock_holders` FK to build custody on.
