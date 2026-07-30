# Zone Delivery and Handover Register — Design

**Date:** 2026-07-30
**Branch:** `feat/zone-handover-register`
**Status:** Approved for implementation
**Source:** Johan Scott, *Zone Handover & PON Submission Tracking*, 2026-07-29

## 1. Problem and goal

FibreFlow has detailed Works QA, OTDR, snag, build-stage and customer-activation
data, but it cannot prove the complete operational handover sequence:

```text
Per PON
Civil complete → Optical complete → Testing passed → Port submitted
→ Port approved → Technically live

Per zone, after every in-scope PON is technically live
Civil Zone QA + Optical Zone QA → all handover snags closed
→ FAC and CAC present → automatic handover
```

The goal is an audited, gate-driven zone delivery register in the existing QA
Centre tab, backed by FibreFlow's canonical PON records.

## 2. Review of Johan's proposal

The proposal correctly identifies that port submission and handover are separate,
that FAC/CAC belong to a zone, and that status must be computed from evidence.
The following corrections are required:

- Customer activation penetration is context, not proof of technical PON
  go-live. The proposed `>=80%` gate is removed.
- `95%` civil QA permits incomplete work. Every PON in approved scope must pass;
  exclusions/cancellations require authorized reasons and audit.
- Testing passed, port submitted, port approved and technical live are separate
  milestones. Test pass requires a linked test pack.
- Civil and optical Zone QA are separate inspections after the whole zone is
  technically live.
- Johan's first-match status order is unreachable because `Civil QA > 0` remains
  true and masks later states. Section 7 defines downstream-first precedence.
- Works QA remains the detailed pole-photo workflow. QA Centre owns the zone
  lifecycle and handover register.

## 3. Product and UI

### 3.1 Navigation

The Civil QA `ModuleNav` order becomes **QA Centre → Works QA → OTDR Testing →
Snags → Reports**. QA Centre owns zone delivery/handover; Works QA remains the
detailed field/photo workflow.

The QA Centre label remains. No sidebar subtree is introduced.

### 3.2 Operational register

`/field-ops` becomes the approved dense, cross-project table with one row per
zone. Summary metrics show total zones, approved-scope PONs, technically-live
PONs, zones ready for Zone QA and handed-over zones.

Filters cover project, zone, current gate, blocker, handover state and text
search. Each row shows:

- Project and zone
- Technically-live PONs / approved-scope denominator
- Earliest incomplete gate
- Exact blocker count
- Separate civil and optical Zone QA
- Handover state/date

Selecting a row opens the dedicated workspace at the stable static route
`/field-ops/zone?project_id=<uuid>&zone_no=<number>`; this avoids a nested dynamic
Pages Router route.

### 3.3 Zone workspace

The selected dedicated-page layout contains a back link, zone identity,
lifecycle rail, scope/live and blocker summary, PON milestone table, separate
civil/optical Zone QA panels, handover snags, FAC/CAC and activity timeline.

It deep-links to Works QA, OTDR and Snags with the current project/zone/PON.
Works QA supplies discipline evidence but is not modified into another tracker.

## 4. Architecture

`pon_stage_tracking` is unique on `(project_id, zone_no, pon_no)` and remains the
canonical PON identity. A one-to-one `pon_delivery_state` extension isolates
supervised milestones from automated 1Map/OES counter syncs.

```text
Works QA / OTDR / Snags / Project Tracker evidence
                         ↓
                 zoneDeliveryService
       permission + prerequisites + evidence + transaction
                         ↓
                zoneDeliveryCalculator
          pure denominator + gates + blockers + status
                         ↓
             Register / workspace / reports
```

The server is authoritative. All reads and commands use the same calculator;
the browser never decides whether a gate passed.

Implementation lives under
`src/modules/construction-qa/zone-delivery/{components,services,types}` with
separate register, workspace, lifecycle rail, PON table, QA, document, snag and
activity components. Files remain under 300 lines and components under 200.
New code uses `@/lib/db` or `@/lib/db-pool`, `apiResponse` and `log`.

## 5. Data model

The additive migration includes a rollback. Its number is chosen immediately
before implementation from the then-current migration sequence.

### 5.1 `pon_delivery_state`

One row per `pon_stage_tracking.id` stores `scope_status`
(`included | excluded | cancelled`) with mandatory exception reason; civil and
optical effective dates/users; test-pass date/user and active test pack; separate
port-submitted and port-approved dates/users; explicit technical-live date/user;
and `row_version`, `created_at`, `updated_at`.

FibreFlow verifies the existing discipline scope and approval evidence, then the
construction supervisor confirms. Civil precedes optical; both precede testing.
The current row is a projection; corrections preserve old/new values in activity.

### 5.2 `zone_delivery_state`

One row per `(project_id, zone_no)` stores scope-approved date/user,
automatically recorded Zone-QA eligibility, independent civil/optical QA status,
notes, effective date and approver, automatic `handed_over_at`, immutable
handover snapshot, and `row_version`, `created_at`, `updated_at`.

`handed_over_at` is terminal. Maintenance issues never reverse it.

### 5.3 Documents, snags and activity

`zone_delivery_documents` is versioned metadata for `test_pack | fac | cac`:
owner, source (`vf_storage | exfo_result`), storage/source reference, filename,
MIME type, size, checksum, uploader and supersession. Test packs belong to PONs;
FAC/CAC belong to zones. File bytes use VF Storage.

`zone_delivery_snag_links` connects existing `snags` rows to the zone, optional
PON, affected gate, handover-blocking flag and reconfirmation requirement. It
does not create a second snag system.

`zone_delivery_activity` is append-only: entity/action, effective and recorded
timestamps, actor/permission, source, reason, and previous/new JSON. Reason is
mandatory for backdating, correction, exclusion and cancellation.

## 6. Gate rules and authority

### 6.1 Scope

A zone has no denominator until scope approval. Included PONs count;
excluded/cancelled PONs remain visible but do not. Authorized changes require
reasons and audit. Adding an included PON before handover immediately
re-evaluates readiness; normal scope changes are locked after handover.

### 6.2 PON milestones

| Gate | Prerequisite | Authority/evidence |
|---|---|---|
| Civil complete | Included PON | Verified scope + construction supervisor |
| Optical complete | Civil complete | Verified scope + construction supervisor |
| Testing passed | Optical complete | Active test pack + testing supervisor |
| Port submitted | Testing passed | Operations |
| Port approved | Port submitted | Operations |
| Technically live | Port approved | Explicit Operations confirmation |

No milestone is inferred from OES/customer activation.

### 6.3 Zone QA and defects

Zone QA unlocks only with an approved, non-zero scope and every included PON
technically live. Civil and optical inspections have independent pass/fail,
snags, dates and approvers; both must pass.

A material pre-handover defect preserves original events, reopens the affected
computed gate, blocks dependants, and requires snag closure plus fresh
role-appropriate confirmation. The timeline retains original and reconfirmation
dates. A post-handover defect becomes a linked maintenance issue.

### 6.4 Automatic handover

After any relevant QA, snag or document change, the service locks the zone row
and requires:

- Civil Zone QA passed
- Optical Zone QA passed
- Zero open handover-blocking snags
- Active FAC and CAC
- No existing `handed_over_at`

It atomically stamps handover, writes a snapshot of scope, milestones, approvals,
document checksums and snag IDs, and appends one event. Concurrent requests are
idempotent. There is no manual toggle.

## 7. Measurement and computed status

Every PON metric is `completed included PONs / included PONs`; there is no
percentage shortcut. The blocker API returns every exact PON/evidence item.

Status precedence:

1. Handover stamped → **Handed over**
2. Scope unapproved/empty → **Scope pending**
3. All PONs live and both QA passed, but snags/FAC/CAC remain →
   **Handover blocked**
4. All PONs live and QA started → **Zone QA in progress**
5. All PONs live and QA not started → **Ready for Zone QA**
6. Every PON port-approved but any not live → **Go-live in progress**
7. Every PON submitted but any not approved → **Awaiting port approval**
8. Every PON tested but any not submitted → **Ready for port submission**
9. Every PON optical-complete but any not tested → **Testing in progress**
10. Every PON civil-complete but any not optical-complete →
    **Optical construction**
11. Any PON not civil-complete → **Civil construction**

For mixed progress, the register shows the earliest incomplete prerequisite and
counts PONs already further ahead.

## 8. Permissions, APIs and errors

The existing `construction-qa.qa-centre` permission controls viewing. New action
permissions are:

- `construction-qa.zone-delivery.scope-manage` — project/scope manager
- `construction-qa.zone-delivery.construction-confirm` — construction supervisor
- `construction-qa.zone-delivery.testing-confirm` — testing supervisor
- `construction-qa.zone-delivery.operations-confirm` — Operations
- `construction-qa.zone-delivery.zone-qa-approve` — QA officer
- `construction-qa.zone-delivery.documents-manage` — authorized project staff

They use existing PostgreSQL RBAC. The API independently enforces permission,
evidence and sequence.

Flat routes:

- `GET /api/zone-delivery/register`
- `GET /api/zone-delivery/zone`
- `POST /api/zone-delivery/scope`
- `POST /api/zone-delivery/pon-milestone`
- `POST /api/zone-delivery/zone-qa`
- `POST /api/zone-delivery/document`
- `GET /api/zone-delivery/activity`

Commands include expected `row_version`; stale writes return `409`. Other stable
error codes cover permission, scope, prerequisite, evidence, blocking snags and
already handed over. Responses include actionable blockers such as
`PON 14 has no active test pack` rather than generic failure. A document counts
only after VF Storage and database metadata both succeed.

## 9. Historical rollout

- Existing counters and evidence may be displayed, but never auto-confirmed.
- Authorized users backfill effective dates from named source records.
- FibreFlow independently records entry time, actor, source and reason.
- Unknown milestones remain unknown and block later gates.
- Historical FAC/CAC registration retains source and checksum.

No shared-database migration is applied without Hein's separate explicit
approval. Design approval does not authorize a dev or production deployment.

## 10. Verification and acceptance

Vitest covers every gate transition, denominator/exclusion rule, independent
Zone QA, reopen/reconfirm path, certificate combination, automatic one-time
handover, mixed-progress status and post-handover immutability.

Repository/service integration tests cover transactional projection+activity,
real permission enforcement, stale versions, concurrent handover, document
supersession, backdating and snapshot contents. API contract tests cover auth,
validation, status codes and structured blockers.

Playwright on port 3004 verifies the tab order, operational register, filters,
stable zone deep link, PON evidence, disabled reasons, separate QA workflows,
FAC/CAC states, responsive behavior and loading/empty/error states. Intercepted
UI tests are labelled contract tests; service integration proves backend gates.
Final checks include targeted Vitest, Playwright and `npm run ci:quick`.

Acceptance requires FibreFlow to answer, with evidence:

1. What is each zone's approved PON denominator and per-gate completion?
2. Which exact PON, evidence, snag or certificate blocks progression?
3. When did the zone become eligible for Zone QA?
4. Who approved civil and optical Zone QA, and when?
5. Were all handover snags closed and which FAC/CAC versions were used?
6. When was handover stamped?
7. Who corrected, backdated, excluded or reconfirmed what, and why?

## 11. Non-goals

No replacement of Works QA/OTDR/Snags/Project Tracker; no customer-activation
readiness gate; no fabricated historical confirmation; no second PON master; no
manual or reversible handover; no OES pipeline change; and no migration or
production deployment under this specification.
