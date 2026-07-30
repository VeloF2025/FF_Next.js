# QField Project Statistics for FibreFlow MCP

**Date:** 2026-07-30

**Status:** Approved design; awaiting written-spec review

**Delivery:** PR 1 of 2

## Context

FibreFlow's production MCP already exposes the read-only FibreFlow API through
three generic tools: endpoint discovery, endpoint description, and authenticated
GET. QField data is technically reachable through those tools, but answering a
simple operational question currently requires the model to discover and combine
multiple inconsistent endpoints.

The existing QField comparison endpoints also have unsuitable semantics for an
authoritative summary:

- pole and drop responses are capped at 200 records;
- cable responses are capped at 100 records;
- QField source failures are converted into empty arrays, which are
  indistinguishable from genuine zero results;
- the legacy sync dashboard can report zero projects while the direct QField
  reconciliation source sees current projects; and
- "applied civil features" is not the same business measure as "poles planted."

The approved business definition is:

> A planted pole is one distinct QField civil feature that is physically in the
> ground. Missing photos or pending QA do not make it unplanted.

Current QField statuses that establish physical planting are:

- `Pole Planted/ All Photos`;
- `Pole Planted - Photos Incomplete`; and
- `Pole Verified/ Civil Complete`.

QA and photo-status changes preserve the most recent physical state. Explicit
`Pole Removed/Canceled` and `Pole Canceled / Removed` events change the physical
state back to not planted. A later planting event can establish it again.

PR 2 will address connector/session diagnostics separately. It is deliberately
outside this design.

## Goals

1. Give Claude one purpose-built, read-only tool for QField project statistics.
2. Resolve a natural project name, project code, FibreFlow UUID, or QField UUID to
   the correct active FibreFlow-to-QField link.
3. Return a concise dashboard by default, with bounded section drill-down.
4. Cover poles, cables, drops, QA, photos, sync health, anomalies, and freshness.
5. Preserve FibreFlow RBAC and the signed-in user's identity.
6. Distinguish genuine zeros, partial results, stale data, and unavailable sources.
7. Make the same definitions reusable by FibreFlow's own API and future UI.

## Non-goals

- No QField, FibreFlow, or sync mutations.
- No database migration.
- No production deployment as part of the PR.
- No replacement of the existing generic MCP tools.
- No connector attachment, Claude Cowork, or client-session repair; that is PR 2.
- No unrestricted raw-record export.
- No silent fallback from QField data to a different source.

## Approved User Experience

The MCP adds this tool:

```text
get_qfield_project_stats(
  project: string,
  section: "summary" | "poles" | "cables" | "drops" |
           "qa" | "sync" | "anomalies" = "summary",
  page: integer = 1,
  limit: integer = 50
)
```

`page` and `limit` apply only to bounded anomaly/detail lists. The tool does not
provide general-purpose raw QField record export.

Example:

```text
User: How many poles were planted in Mahikeng?

Claude calls:
get_qfield_project_stats(project="Mahikeng", section="summary")
```

The answer must identify the resolved FibreFlow and QField projects, report the
physical planted-pole count, include the QField update time and freshness state,
and surface relevant warnings. It must report photo completeness and QA
separately rather than using them to exclude physically planted poles.

The tool description will explicitly tell the model to use this tool for QField,
field-build, planted-pole, cable, drop, QField QA, and QField sync-stat questions.

## Architecture

```text
Claude
  -> get_qfield_project_stats
  -> FibreFlow MCP thin adapter
  -> GET /api/qfield/project-stats
  -> authenticated project resolver
  -> QField project-statistics service
       -> FibreFlow PostgreSQL readers
       -> QFieldCloud read-only PostgreSQL readers
       -> MinIO metadata reader
  -> stable JSON response
```

The MCP remains a thin, unprivileged client. Domain definitions and aggregation
live in FibreFlow so other consumers use the same result.

### MCP adapter

A dedicated QField MCP module registers `get_qfield_project_stats` and uses the
existing per-user FibreFlow credential, rate limit, timeout, and HTTP error
handling. It URL-encodes all query values and calls only the fixed
`/api/qfield/project-stats` path.

The generic `list_endpoints`, `describe_endpoint`, and `fibreflow_get` tools stay
available and unchanged in behaviour.

### API route

`GET /api/qfield/project-stats` accepts:

- `project`: required name, code, FibreFlow UUID, or QField UUID;
- `section`: optional bounded section, default `summary`;
- `page`: drill-down page, default `1`;
- `limit`: drill-down size, default `50`, with a server-side maximum.

The route uses the existing `withAuth` path and returns the standard
`apiResponse` envelope. It does not accept write methods.

### Project resolver

Resolution follows this order:

1. exact FibreFlow UUID;
2. exact QField UUID;
3. exact case-insensitive FibreFlow project code;
4. exact case-insensitive project name;
5. partial case-insensitive name match.

The resolver then prefers an active registered QField project linked through
`qfield_project_links`.

- One valid linked project: continue.
- Multiple valid linked projects: return `409` with safe candidate names and IDs.
- FibreFlow project without a valid QField link: return a structured `422`.
- No visible match: return `404`.

Resolution must respect the authenticated user's existing project access. It
must not reveal inaccessible projects as candidates.

## Data Sources and Ownership

| Area | Authoritative source | Purpose |
|---|---|---|
| Project identity and link | FibreFlow PostgreSQL | Project resolution and RBAC scope |
| Field status and freshness | QFieldCloud `core_delta` through read-only PostgreSQL | Latest QField feature state |
| FibreFlow comparison totals | FibreFlow PostgreSQL | Sync discrepancy calculations |
| QA | `qfield_photo_validations` and action tables | Workflow and retake statistics |
| Sync | `qfield_sync_jobs` and conflicts | Current job, history, failures, conflicts |
| Photo/design integrity | QField MinIO metadata and verified design cache | Missing photos and design coverage |

New QField reads must use the established read-only QField connection. The
aggregator must not depend on the legacy endpoints that swallow source errors or
truncate source records.

The legacy `core_layer`/`core_feature` readers are not a valid source in the
current production QField schema. They must not be reused or treated as evidence
of a genuine zero.

## Counting Semantics

### Poles

Feature identity remains `(kind, localPk)`, never `localPk` alone.

For each civil feature:

1. consider successfully applied, status-bearing deltas in deterministic
   timestamp-and-ID order;
2. trim surrounding whitespace from each status;
3. set physical state to planted for `Pole Planted/ All Photos`,
   `Pole Planted - Photos Incomplete`, or `Pole Verified/ Civil Complete`;
4. set physical state to not planted for `Pole Removed/Canceled` or
   `Pole Canceled / Removed`; and
5. leave physical state unchanged for QA, photo, WIP, and other non-physical
   status changes.

A later failed or stuck duplicate does not remove an earlier successfully
applied state. It is reported as an anomaly and cannot create an additional
planted pole. Photo completeness and QA approval are separate quality measures
and are not prerequisites for the planted count.

The pole section returns:

- planted count;
- complete source-status distribution;
- applied, stuck-recoverable, and stale-duplicate counts;
- design total and never-captured count when a valid design layer exists;
- missing-photo count; and
- `null` plus a warning for design-derived measures when no design layer exists.

### Cables

Cable statistics use a stable QField feature identity and the most recent applied
state. They return:

- QField and FibreFlow totals;
- total measured length where available;
- the complete source-status distribution;
- synchronized, needs-sync, QField-only, and FibreFlow-only counts; and
- source update time.

Status labels remain visible rather than being forced into invented categories.

### Drops

Drop statistics use the stable drop identifier and latest applied state. They
return:

- QField and FibreFlow totals;
- complete installation- and QC-status distributions;
- installed/completed, planned, in-progress, approved, pending, and failed
  headline counts where the source status maps unambiguously;
- synchronized, needs-sync, QField-only, and FibreFlow-only counts; and
- source update time.

Unknown source statuses remain in the distribution and generate a mapping
warning; they are never discarded.

### QA and photos

QA statistics include total validations, pending, in-review, approved, rejected,
escalated, overdue, needs-retake, completed-retake, confidence bands, work-type
breakdown, priority breakdown, and the signed-in user's queue.

Photo integrity includes referenced, present, and missing counts when MinIO is
available. It returns `null`, not zero, when MinIO is unavailable.

### Sync health

Sync statistics include the current job, last completed job, successful and
failed totals, processed/created/updated/failed records, unresolved conflicts,
and the last successful completion time.

Current `qfield_sync_jobs` and `qfield_sync_conflicts` rows have no project ID.
Their response therefore includes `scope: "system"` and must never be described
as specific to the resolved project.

## Response Contract

The summary response has this shape:

```json
{
  "status": "complete",
  "project": {
    "fibreflow": { "id": "...", "code": "...", "name": "Mahikeng" },
    "qfield": { "id": "...", "name": "HT_Mahikeng" }
  },
  "freshness": {
    "lastQFieldUpdateAt": "2026-07-29T11:34:04Z",
    "weekdayAgeHours": 16.4,
    "state": "fresh",
    "warningSuppressed": false,
    "policy": "stale after 24 weekday hours; weekend warnings suppressed"
  },
  "poles": {
    "planted": 0,
    "byStatus": {},
    "applied": 0,
    "stuckRecoverable": 0,
    "staleDuplicates": 0,
    "designTotal": null,
    "neverCaptured": null,
    "missingPhotos": 0
  },
  "cables": {},
  "drops": {},
  "qa": {},
  "sync": {},
  "sourceHealth": {},
  "warnings": [],
  "generatedAt": "..."
}
```

The example values illustrate shape only and are not fixtures or expected
production counts.

`status` is:

- `complete`: all required summary sources succeeded;
- `partial`: useful results exist, but at least one optional source failed; or
- `unavailable`: the primary QField source failed.

Drill-down sections use the same project, freshness, source-health, and warning
metadata. Anomaly/detail lists are paginated, field-limited, and capped; aggregate
totals always describe the full filtered dataset, not merely the returned page.

## Freshness Policy

Freshness uses `Africa/Johannesburg`.

- The clock advances during Monday through Friday and excludes all Saturday and
  Sunday hours.
- Data becomes stale after more than 24 accumulated weekday hours.
- On Saturday and Sunday, stale warnings are suppressed and
  `warningSuppressed` is `true`.
- On Monday, evaluation resumes using the weekday age accumulated before and
  after the weekend.
- The raw update timestamp and computed weekday age are always returned.
- Missing or invalid timestamps produce `state: "unknown"` and a warning.

Public-holiday handling is not included.

## Failure Semantics

- A failed source is never converted to an empty array or numeric zero.
- Optional-source failure returns `200` with `status: "partial"`, `null` affected
  metrics, source-health details, and a warning.
- Primary QField failure returns `503`.
- Invalid parameters return `400`.
- Permission failures remain `403` and are not retried through alternate routes.
- Multiple project matches return `409`.
- Missing project returns `404`.
- Upstream credentials, tokens, connection strings, raw SQL errors, and
  stack traces never appear in the response.

Independent sources are read concurrently with bounded timeouts. One slow
optional source must not consume the entire request budget.

## Security and Privacy

- The route is GET-only and authenticated with existing FibreFlow auth.
- The MCP passes the signed-in user's existing read-only credential.
- No service-level FibreFlow credential or database secret is added to the MCP.
- Existing project visibility and role rules apply before project resolution.
- Drill-down excludes customer names, addresses, geometry, photo bodies, and
  other record-level personal data unless a later separately approved design
  explicitly requires them.
- Logs contain identifiers and aggregate operational metadata, not returned
  business data.

## Observability

Each API and MCP request records structured metadata:

- request/correlation ID;
- tool name and section;
- authenticated user ID in the FibreFlow API log;
- OAuth client/grant identifier in the MCP log, without an extra identity lookup;
- resolved FibreFlow and QField project IDs;
- total duration and per-source duration;
- complete/partial/unavailable result;
- source-health states; and
- error category.

Tokens, query credentials, raw response bodies, and business-record payloads are
never logged.

## Verification

### Unit tests

- physical planting state transitions across planting, verification,
  removal/cancellation, photo, and QA events;
- latest-successfully-applied selection;
- `(kind, localPk)` feature identity;
- stuck and stale duplicate handling;
- full status distributions and unknown statuses;
- project resolution order, linked-project preference, and ambiguity;
- weekday freshness, including Friday-to-Monday and weekend suppression;
- aggregate totals independent of pagination; and
- complete, partial, unavailable, and genuine-zero semantics.

### API tests

- authentication and existing project permissions;
- name, code, FibreFlow UUID, and QField UUID resolution;
- parameter validation and maximum page size;
- `404`, `409`, `422`, `403`, and `503` paths;
- optional-source timeout and partial result; and
- no sensitive fields in summary or drill-down.

### MCP tests

- tool registration and load-bearing description;
- fixed endpoint path and URL-encoded parameters;
- per-user token forwarding;
- rate limiting, timeout, and upstream error propagation;
- default summary and every supported section; and
- response-size guard.

### Required gates

- MCP Python test suite;
- relevant Vitest/API suites;
- `npm run ci:quick`;
- `npm run antihall`; and
- authenticated dev API smoke tests for at least Mahikeng and one
  ambiguous/missing project case;
- local MCP transport/tool tests against the dev API; and
- a live connector smoke test only after an explicitly approved production
  deployment.

## Acceptance Criteria

1. A natural-language Mahikeng planted-pole question selects the curated MCP tool
   without generic endpoint discovery.
2. The returned planted count includes distinct features whose last applied
   physical-state event leaves them in the ground, regardless of later photo or
   QA state.
3. Summary and section totals agree.
4. No hard record limit can silently undercount an aggregate.
5. Source failure cannot appear as a zero.
6. Responses include project mapping, source health, update time, freshness, and
   warnings.
7. RBAC and read-only enforcement are unchanged.
8. All required verification gates pass.

## Delivery and Rollout

Implementation will occur on an isolated worktree from current `origin/master`
and ship through a pull request. The PR contains no schema migration.

After review:

1. deploy to dev using `bash scripts/deploy-local.sh dev`;
2. run authenticated API and MCP smoke tests;
3. obtain Hein's explicit production approval; and
4. deploy production after hours using
   `bash scripts/deploy-local.sh production`.

PR 2 will receive a separate design for connector/session diagnostics after this
delivery. It will not be folded into PR 1.
