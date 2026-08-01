# Velocity Fibre GHL Review Export Design

**Date:** 2026-08-01

**Status:** Approved design; implementation and live activation not yet approved

**Owners:** FibreFlow operations and the Velocity Fibre GoHighLevel location

## 1. Goal

Automatically identify every relevant customer DR from the previous South
African calendar day, resolve a safe customer mobile number, and enrol the
contact into Velocity Fibre's GoHighLevel (GHL) WhatsApp review workflow.

The automation must help satisfied customers reach the review request while
routing installation or connectivity problems to Chantall for follow-up. It
must not use Make, Zapier, browser-driven imports, or a FibreFlow WhatsApp
sender.

## 2. Approved operating model

FibreFlow owns:

- daily candidate selection;
- customer-phone resolution and validation;
- deduplication and the durable export ledger;
- GHL contact upsert and trigger-tag application;
- retry, catch-up, reconciliation, and operational reporting.

GHL owns:

- contact Smart Lists;
- WhatsApp templates and sends;
- response branching;
- support assignment and internal notifications;
- happy-customer and post-resolution review requests.

The end-to-end boundary is:

```text
FibreFlow 09:00 SAST job
  -> GHL contact upsert and transient trigger tag
  -> native GHL workflow
  -> WhatsApp template and response branches
```

Adding a contact to a "sending list" means upserting it and applying a
deterministic tag. A GHL Smart List is a dynamic view over those contact and tag
properties; it is not a separate import destination.

## 3. Daily candidate population

### 3.1 Calendar boundary

The scheduled run starts at 09:00 `Africa/Johannesburg` each day. All timestamp
comparisons are converted to that timezone before extracting the calendar date.
Database or host timezone defaults must not define the target day.

Under normal operation the target is the previous unprocessed SAST calendar
day. Catch-up behaviour is defined in section 9.

### 3.2 Source union

The candidate query unions distinct, normalised DR numbers from all of these
events for the target date:

| Event | Initial FibreFlow source |
| --- | --- |
| Installation/DR submitted | `dr_photo_unified_reviews.submitted_date` |
| Drop installed | local date of `drops.installed_at`, falling back to `drops.installation_date` |
| Stock serial installed at a DR | `stock_serials.installed_date` with `installed_at_drop_number` |
| OES activated | local date of `oes_activations.activation_datetime`, falling back to `activation_date` |
| PP activated/resolved | local date of `activated_at`, falling back to `first_resolved_at` and then `resolved_at` in `oes_pp_data` |
| OLT mismatch recorded | local date of `olt_mismatch_records.created_at` |

PP rows are eligible only when their resolution status is `activated` and they
have a resolved DR number. Blank DR numbers are rejected.

The union deliberately includes records regardless of QA outcome. A DR present
in several sources remains one candidate with all source flags retained for
audit and reporting.

### 3.3 Live discovery evidence

A read-only check for 2026-07-31 found:

- 157 unique DR candidates across the approved source union;
- 149 with exactly one valid customer mobile;
- 8 without a valid customer mobile;
- 0 with conflicting valid customer mobiles.

These values are a planning snapshot, not hard-coded acceptance totals.

## 4. Customer identity and phone resolution

### 4.1 Allowed recipient data

Only a subscriber/customer contact number may be used. Technician, WhatsApp
sender, crew, or submitter phone fields are never eligible.

The initial resolver uses this source order:

1. the latest deterministic `onemap_properties.contact_number` for the DR;
2. the cached subscriber phone on the latest unified review;
3. the QContact phone on the latest unified review.

Duplicate OneMap property rows are ordered by `updated_at`, then `import_id`,
then `id`, all descending with nulls last. The current live OneMap API response
must not be assumed to contain a phone number: implementation may adopt a live
endpoint only after its contact-number contract is proven.

All available current-source values are normalised before comparison. If two
trusted current sources resolve to different valid mobiles, the candidate is
quarantined rather than choosing silently.

### 4.2 Normalisation

The canonical phone format is E.164. Initially accepted South African mobile
forms are:

- `+27` followed by nine mobile digits;
- `27` followed by nine mobile digits;
- a local ten-digit mobile beginning with `06`, `07`, or `08`;
- a nine-digit mobile beginning with `6`, `7`, or `8` and missing the South
  African prefix.

Punctuation and spaces are removed before validation. Landlines, malformed
numbers, blank values, and ambiguous values are quarantined.

### 4.3 Contact names

FibreFlow may populate a customer name when GHL has no useful name. It must not
overwrite a non-empty GHL name with lower-quality source data. The WhatsApp
template uses a safe `there` fallback when no usable first name exists.

## 5. Idempotency and data model

### 5.1 Sending identity

The permanent deduplication key is:

```text
(normalised DR number, normalised customer phone)
```

The same pair can never be enrolled twice, including after retries or catch-up
runs. The same phone on a genuinely different DR is a different eligible pair
and may be contacted again.

At most one trigger handshake may be in flight for a phone at a time. Different
DRs sharing a phone are queued and triggered sequentially; they are not merged
or discarded.

### 5.2 Run ledger

A run table records one row per target date, including:

- status and run timestamps;
- source and candidate counts;
- terminal, retryable, and quarantined counts;
- catch-up position;
- summary-notification status.

The target date is unique. Parallel schedulers must acquire a database lock or
an equivalent atomic claim before processing it.

### 5.3 Export ledger/outbox

An export table records one row per deduplication key, including:

- target event date and normalised DR;
- a protected E.164 phone value and non-reversible phone fingerprint;
- source flags and the selected phone source;
- an opaque export key;
- GHL contact ID;
- state, attempt count, next-attempt time, and safe error code;
- timestamps for discovery, upsert, trigger request, acknowledgement, and
  terminal outcome.

The database unique constraint uses `(dr_number, phone_fingerprint)`. Raw phone
numbers are never written to application logs, notification bodies, or error
messages.

Expected states include `discovered`, `quarantined`, `ready`, `upserting`,
`contact_upserted`, `trigger_requested`, `workflow_acknowledged`,
`retryable_failure`, and `permanent_failure`. State changes use conditional
updates so two workers cannot process one export concurrently.

## 6. GHL contact import and trigger handshake

### 6.1 Contact upsert

For each ready export FibreFlow:

1. searches the Velocity GHL location by normalised phone;
2. creates or updates one contact without overwriting authoritative GHL data;
3. preserves all GHL DND and opt-out settings;
4. writes the current DR metadata to dedicated custom fields;
5. confirms the contact and field values by API readback;
6. starts the transient trigger-tag handshake.

Required custom fields are:

- `velocity_dr_number`;
- `velocity_dr_event_date`;
- `velocity_dr_sources`;
- `velocity_review_export_key`.

Credentials and IDs are supplied through deployment configuration and are not
stored in source, plans, logs, or notifications.

### 6.2 Transient tags

The trigger tag is `velocity-review-ready`. The GHL workflow must allow repeat
entry and, as its first acknowledgement actions:

1. add `velocity-review-enrolled`;
2. remove `velocity-review-ready`.

FibreFlow confirms the acknowledgement tag and unchanged opaque export key
before marking the export `workflow_acknowledged`. FibreFlow then clears the
acknowledgement tag, making the contact ready for a different DR later.

Before applying the trigger tag, FibreFlow verifies that neither transient tag
represents another in-flight export for the phone. This prevents a contact-level
tag from collapsing two distinct DR enrollments.

An acknowledged workflow enrollment is not reported as WhatsApp delivery. GHL
remains authoritative for message status and replies.

If acknowledgement is uncertain, FibreFlow fails closed. It must not remove and
re-add the trigger automatically when that could cause a second message. The row
is held for reconciliation and included in the failure summary.

## 7. Native GHL WhatsApp workflow

### 7.1 Initial message

The current active experience templates refer to Hein. Before activation, a new
Meta-approved Velocity template must use the approved company persona:

> Hi {{first_name}}, it's Velo from Velocity Fibre. Our team recently completed
> the fibre installation at your property. How did the installation go, and is
> your fibre connection working?

The template provides three quick replies:

- `Happy & connected`
- `Installation issue`
- `Not connected`

### 7.2 Response branches

**Happy & connected**

- apply the happy/connected classification;
- keep the contact out of both support queues;
- immediately use the active `velocity_review_request_v1` review template;
- allow the existing approved reminder behaviour if it remains enabled.

**Installation issue**

- suppress review requests;
- apply a dedicated installation-issue tag;
- place the contact in the installation-issue Smart List;
- assign the conversation to Chantall;
- immediately notify Chantall inside GHL.

**Not connected**

- suppress review requests;
- apply a separate not-connected tag;
- place the contact in the connection-problem Smart List;
- assign the conversation to Chantall;
- immediately notify Chantall inside GHL.

A reply that does not match a quick-reply branch must never receive an automatic
review request. It remains visible for manual triage in GHL.

### 7.3 Resolution path

Chantall explicitly applies the existing `issue-resolved` tag after resolving a
problem. That tag starts the existing draft post-resolution review workflow,
which must be tested and published before live activation.

GHL's DND, opt-out, and STOP handling is authoritative at every message step.
FibreFlow never clears or bypasses those controls.

## 8. Retry and reconciliation

Retryable GHL failures include rate limiting, timeouts before any accepted
mutation, and temporary server errors. Retries use bounded exponential backoff,
honour `Retry-After`, and resume from the last confirmed ledger state.

The adapter always reads current GHL state before retrying a contact mutation.
An ambiguous trigger or workflow acknowledgement is not retried automatically.
One failed contact does not stop unrelated candidates in the same date batch.

Permanent failures include invalid recipient data, confirmed DND/opt-out,
unresolvable source conflicts, and rejected GHL validation. They are terminal
for that export pair and appear in the run summary.

## 9. Missed days and catch-up

Every scheduled invocation looks for unprocessed dates before processing the
normal previous day. It processes the oldest gap first and may catch up every
missing day within the most recent seven-day window.

The first production activation records an explicit go-live watermark. Dates
before that watermark are not inferred as missed and are not sent unless Hein
separately approves a historical backfill.

A date is complete only when every discovered candidate has a terminal outcome
or an acknowledged workflow enrollment. Retryable and ambiguous rows keep the
date incomplete.

If the oldest gap is more than seven days old, automatic sending stops. The job
alerts the operational recipients and requires explicit approval for a stale
backfill. This prevents unexpected outreach for old installations.

## 10. Operational summaries

After each run, FibreFlow sends a redacted operational summary to Chantall,
Hein, and Michael. Recipient addresses or user IDs are resolved from deployment
configuration rather than embedded in code.

The summary includes:

- target date and whether it was normal or catch-up processing;
- DRs by source and total unique DRs;
- contacts upserted;
- duplicate pairs suppressed;
- missing, invalid, conflicting, and opted-out recipients;
- GHL workflow acknowledgements;
- retryable, ambiguous, and permanent failures;
- remaining catch-up dates.

The wording must say `workflow acknowledged`, not `message delivered`, unless a
separate GHL delivery event has actually been reconciled.

## 11. Security and privacy

- GHL credentials live only in approved server environment configuration.
- The integration is restricted to the Velocity GHL location.
- Customer phones are redacted from logs and summaries.
- Error persistence uses safe codes and sanitised messages.
- GHL opt-out and DND state is never weakened.
- No browser automation is used for recurring operation.
- No direct WhatsApp API send is performed by FibreFlow.
- No Make or Zapier dependency is introduced.

## 12. Verification and rollout

### 12.1 Automated tests

Tests must cover:

- SAST calendar-day selection for every source;
- source union and source-flag aggregation;
- DR and phone normalisation;
- duplicate source rows and duplicate OneMap rows;
- same DR/same phone suppression;
- same phone/different DR eligibility and sequencing;
- missing, invalid, and conflicting phones;
- contact-field preservation and DND handling;
- retryable, permanent, and ambiguous GHL outcomes;
- transient-tag acknowledgement and cleanup;
- scheduler locking, partial failure, and seven-day catch-up;
- summary counts and phone redaction.

Database-backed integration tests use the project's real PostgreSQL test setup.
The GHL adapter uses contract fixtures in automated tests; mocks must not be
presented as evidence of a live enrollment.

### 12.2 Live preflight and staged rollout

Rollout is gated in this order:

1. dry-run a recent day without GHL writes and reconcile candidate totals;
2. upsert internal test contacts and verify custom-field readback;
3. configure the Smart Lists and draft GHL workflows;
4. obtain Meta approval for the Velo-branded template;
5. exercise all three response branches with internal contacts;
6. verify assignment and notification to Chantall;
7. verify the `issue-resolved` post-resolution path;
8. run one small, supervised customer batch;
9. reconcile GHL workflow acknowledgement, actual WhatsApp delivery, and branch
   routing;
10. obtain explicit approval for production deployment and workflow publishing;
11. record the production go-live watermark;
12. enable the autonomous 09:00 SAST schedule.

Preparing code and draft workflows does not authorise customer sends. Production
deployment and publishing the customer-sending workflow remain explicit live
change gates.

## 13. Acceptance criteria

The design is complete when implementation evidence shows that:

1. every approved source contributes target-day DRs in SAST;
2. each DR is collapsed to one candidate with all source flags retained;
3. only an unambiguous customer mobile can proceed;
4. the same DR/phone pair cannot trigger twice under concurrency, retry, or
   catch-up;
5. a different DR on the same phone can trigger after the prior handshake;
6. FibreFlow only upserts GHL contacts and applies transient workflow tags;
7. native GHL automation sends the Velo template and routes all approved
   branches;
8. problem branches suppress reviews and notify Chantall;
9. `issue-resolved` starts the post-resolution review workflow;
10. missed days catch up within seven days and older gaps fail closed;
11. the first run does not infer pre-launch dates as missed;
12. summaries reach Chantall, Hein, and Michael without exposing phone numbers;
13. no Make, Zapier, browser import, or FibreFlow WhatsApp sender is involved.

## 14. Out of scope

- direct WhatsApp sending from FibreFlow;
- automated diagnosis or closure of customer support issues;
- stale backfills older than seven days without explicit approval;
- changes to Blitz Fibre workflows or other GHL locations;
- treating GHL API acceptance or workflow acknowledgement as delivery proof.
