# WhatsApp Cloud go-live: templates, consent, and outbound preconditions

Status: **draft for FNO negotiation and Meta submission.** Nothing here is live.
`wa_provider` is still `bridge` and all four `cloud_*` credentials are unset.

Companion to `.claude/modules/wa-cloud-provider.md` (send-path architecture).
This document covers the *business* prerequisites, which are the actual blockers.

---

## 1. Why this is business-initiated, and what that costs

Velocity does not receive fault reports from subscribers. The FNO (the client)
raises a ticket and passes the subscriber's details. **Velocity always makes first
contact.** That has three consequences on the WhatsApp Business Platform:

1. **Every conversation must open with an approved template.** Free-form messages
   are only permitted inside the 24-hour customer service window, and that window
   only opens once the subscriber replies. No provider — direct Cloud API or any
   BSP (Twilio, 360dialog, Wati) — is exempt; this is Meta platform policy.
2. **Opt-in is required before the first template.** Meta requires consent naming
   the business and its intent, and reactively audits opt-in flows. Subscribers
   consented to the *FNO*, not to Velocity — see §4.
3. **From 1 October 2026, replies inside the 24-hour window are chargeable** at
   utility/authentication rates with no volume discount (announced 1 July 2026;
   per-market rates due before 1 September 2026). Cost per ticket must be modelled
   as `1 template + N replies`, not `1 template + free conversation`.

Template *approval* is not the bottleneck — the three templates below are textbook
Utility category. Consent and data availability are the bottlenecks.

---

## 2. Data readiness — measured, then corrected

### 2.1 What our own tables hold

Queried against the shared Supabase DB on 2026-07-28, last 90 days,
`COUNT(DISTINCT maintenance_tickets.id)`:

| Population | Tickets | Share |
|---|---|---|
| Tickets created | 4,125 | 100% |
| Have `client_contact` populated | 161 | 3.9% |
| Contact present in our `onemap_properties` mirror | 785 | 19.0% |

By source, `client_contact` is populated **only** on `pp_data` (161 of 1,606).
`wa_no_oes` (942), `manual` (937), `olt_mismatch` (394) and `snags` (245) carry
**zero** contacts. `dr_number` is far better populated (2,962 of 4,125).

These are a rolling 90-day window on a live table, so re-running them a few days
later will drift by a ticket or two as rows age in and out. An independent re-run on
2026-07-28 reproduced 4,125 and 161 exactly, and returned 787 / 936 / 246 / 2,963
against the 785 / 937 / 245 / 2,962 above. Treat them as accurate to ±0.1%, not as
fixed constants.

### 2.2 ⚠️ Correction — 1Map holds far more than our mirror

An earlier draft of this document concluded from the numbers above that the
subscriber's number "cannot be derived at usable coverage" and must come from the
FNO. **That conclusion was wrong**, and it was wrong because it measured our
mirror rather than 1Map.

Queried directly against the live 1Map API (layer 5121, authenticated session,
2026-07-28): **11 of 12 sampled DRs that are blank in our mirror have a populated
`contnr` (contact number) in 1Map.** All 20 DRs sampled returned records.

The cause is a lossy ingest, not missing data:

- `onemap_properties` is populated by `scripts/import-onemap-smart.js` from
  **spreadsheet exports**, mapping a single CSV column
  (`Contact Number (e.g.0123456789)`) into `contact_number`.
- The live 1Map record carries **216 fields**, of which roughly 25 are
  phone-bearing: `contnr`, `contnr_alt`, `cnt_cell`, `cell01`–`cell20`,
  `cell_sales`, `cell_pe`, `cell_hs`, `cell_hi`, plus `email`. **We import one.**
- `scripts/backfill-contact-info.js` attempts to fill the gap from BOSS, but BOSS
  reads the *installations* layer, which does not carry the sign-up contact —
  measured across 20 DRs, BOSS never returned a number our mirror lacked.

**Revised conclusion: the numbers are very likely already in 1Map. The work is to
sync `contnr` (and the `cell*` fallbacks) from the 1Map API rather than from
spreadsheet exports.** Consent from the FNO is still required regardless — see §4 —
but "we have no way to reach the subscriber" is not a correct statement of the
problem.

**Confidence: MEDIUM.** The sample is 12 blank DRs; a 50-DR follow-up run was cut
short. A server-side run over a few hundred DRs should firm up the real coverage
before this is used to size anything.

### 2.3 Related defects found while measuring

- `ticketEnrichmentService.lookupOneMapDrop()` queries `onemap_drops` (0 rows), so
  ticket enrichment returns nothing. **Still live in the codebase** — fix proposed
  in PR #2289, open and not yet merged as at 2026-07-28.
- `oneMapApiService.authenticate()` returns `true` whenever a session cookie comes
  back, without checking the credentials were accepted — so a future credential
  expiry would surface as a misleading "API returned failure" rather than an auth
  error. Not currently causing an outage.

The production 1Map credential (`ettiene@`) is **verified working** end-to-end:
login returns 302 and `getattributes` returns `success: true`. The 1Map read path
and the OLT report endpoints that depend on it are healthy. Syncing `contnr` is
tracked in issue #2292.

### FNO attribution per ticket

The FNO *is* resolvable per ticket:

```
maintenance_tickets.project_id → public.projects.id::text
public.projects.client_id      → public.clients.company_name
```

Current values (all-time, as at 2026-07-28): `fibertime` (5,900 tickets),
`Herotel Proprietary Limited` (37).

Two distinct measures, which an earlier draft conflated — they are not the same
number and should not be quoted interchangeably:

| Measure | Definition | Figure (as at 2026-07-28) |
|---|---|---|
| Missing `project_id` | ticket has no project at all | **23.0%** all-time (1,837 / 8,002) |
| **FNO unresolvable** | `clients.company_name` is NULL after the join — no project, *or* a project with no client | **9.8%–30.8%** by month over Mar–Jul 2026; 21.4% in July |

The second is the one that matters here, because it is what actually determines
whether a template can be filled. Monthly detail: Mar 20.1%, Apr 18.2%, May 30.8%,
Jun 9.8%, Jul 21.4%. (Jan–Feb 2026 are excluded — 13 and 147 tickets, ~100%
unresolved, too small and too early to be representative.)

The templates below name the appointing FNO in the first line, so an unresolved FNO
must **block the send** — a blank or wrong brand is worse than no message.

---

## 3. Utility templates for Meta submission

Category **Utility**, language **en**. None starts or ends with a variable, and each
carries enough static text for its variable count — the two most common rejection
causes. Quick-reply buttons are deliberate: a one-tap reply is a customer message,
which opens the 24-hour window at no extra cost.

### 3.1 `fault_logged_ack` — sent on ticket creation, opens the conversation

> **Header:** Service fault update
>
> **Body:**
> Hello {{1}}, this is Velocity Fibre. We have been appointed by {{2}} to attend to
> the fault reported at {{3}}.
>
> Reference: {{4}}
> Logged: {{5}}
>
> We will update you here as the job progresses. Reply to this message if any of the
> details above are incorrect.
>
> **Footer:** Velocity Fibre — appointed maintenance contractor
> **Buttons:** `Thanks` · `Details are wrong`

| Var | Source |
|---|---|
| `{{1}}` | `maintenance_tickets.client_name` |
| `{{2}}` | FNO — `clients.company_name` via `project_id` (see §2) |
| `{{3}}` | `maintenance_tickets.address` |
| `{{4}}` | `maintenance_tickets.dr_number` |
| `{{5}}` | `maintenance_tickets.created_at` |

### 3.2 `technician_scheduled` — dispatch confirmation

> **Header:** Technician scheduled
>
> **Body:**
> Hello {{1}}, a Velocity Fibre technician is scheduled to attend {{2}} on {{3}}.
>
> Reference: {{4}}
>
> Someone aged 18 or older must be present to provide access. Reply here to confirm,
> or to arrange a different time.
>
> **Footer:** Velocity Fibre — appointed maintenance contractor
> **Buttons:** `Confirm` · `Reschedule`

`{{1}}` `client_name` · `{{2}}` `address` · `{{3}}` `due_at` · `{{4}}` `dr_number`

### 3.3 `fault_resolved` — closure with a reopen path

> **Header:** Work completed
>
> **Body:**
> Hello {{1}}, the fault at {{2}} has been resolved and the service tested.
>
> Reference: {{3}}
> Completed: {{4}}
>
> If your service is still not working, reply here within 48 hours and we will
> reopen the job.
>
> **Footer:** Velocity Fibre — appointed maintenance contractor
> **Buttons:** `Service is working` · `Still faulty`

`{{1}}` `client_name` · `{{2}}` `address` · `{{3}}` `dr_number` · `{{4}}` `resolved_at`

**Why these should clear Utility review:** each references a specific existing
service event the subscriber is party to, carries a reference number, contains no
promotional language, and identifies both the sender and the appointing party in the
first line — which is also what keeps block rates (and therefore quality rating)
down.

---

## 4. Consent clause for the FNO agreement

Achieves two things: Meta's opt-in requirement, and a POPIA basis for the FNO to
share subscriber contact details with Velocity. **Have this reviewed by an
attorney — it is a commercial draft, not legal advice.**

> **WhatsApp and electronic communication consent**
>
> **1.** The Client warrants that it has obtained, and will maintain, each
> Subscriber's informed consent for the Client and its appointed maintenance
> contractors — including Velocity Fibre (Pty) Ltd — to contact that Subscriber on
> WhatsApp and by SMS in relation to the installation, maintenance, fault resolution
> and testing of that Subscriber's fibre service.
>
> **2.** Such consent shall be obtained at Subscriber onboarding, shall name
> WhatsApp as a channel, shall identify the appointed contractor by name or by the
> description "appointed maintenance contractor", and shall state the purpose in
> clause 1. Consent obtained solely for marketing purposes does not satisfy this
> clause.
>
> **3.** For every service request passed to Velocity Fibre, the Client shall
> transmit the Subscriber's contact number together with a consent indicator and the
> date on which consent was obtained. Velocity Fibre shall not initiate WhatsApp
> contact where that indicator is absent.
>
> **4.** The Client shall notify Velocity Fibre within 2 business days where a
> Subscriber withdraws consent. Velocity Fibre shall cease WhatsApp contact with that
> Subscriber upon notification, and shall honour any opt-out or block a Subscriber
> applies directly.
>
> **5.** The Parties record that Subscriber contact details are shared under the
> Protection of Personal Information Act 4 of 2013 for the sole purpose in clause 1,
> that Velocity Fibre processes such information as an operator on the Client's
> behalf, and that Velocity Fibre shall not use it for any other purpose or retain it
> beyond the period required for service delivery and record-keeping.
>
> **6.** The Client indemnifies Velocity Fibre against any claim, penalty,
> regulatory finding or platform sanction — including suspension or restriction of
> Velocity Fibre's WhatsApp Business account — arising from a consent indicator
> transmitted under clause 3 that was inaccurate, withdrawn, or not obtained in
> accordance with clause 2. Velocity Fibre's obligation is limited to not initiating
> contact where the indicator is absent, and to ceasing contact on notice under
> clause 4; it is not obliged to independently verify the Client's consent records.

**Why clause 6 exists.** Without it, clause 3 obligates the Client to send a consent
indicator but leaves Velocity carrying the entire downside if that indicator is
wrong. The exposure is not hypothetical: Meta reactively audits opt-in flows, and
the penalty lands on the *sender's* number — template sending blocks through to
permanent account disabling — regardless of who supplied the bad data. A POPIA
complaint would likewise name Velocity as the party that sent the message. This is
the first gap a client's own counsel would find.

---

## 5. Outbound preconditions the code must enforce

Clause 3 is worthless if the send path does not enforce it. Every business-initiated
send must **fail closed** unless all four hold:

| # | Precondition | Why |
|---|---|---|
| 1 | Consent indicator present on the ticket | Meta opt-in policy + POPIA |
| 2 | Subscriber contact number present and SA-normalisable | Most tickets lack one on the ticket itself. 1Map appears to hold it — **MEDIUM confidence, 12-DR sample (§2.2)**, not yet sized |
| 3 | FNO resolvable for the ticket | Template names the appointing party; ~20% unresolved |
| 4 | An approved template for the event type | Business-initiated cannot be free-form |

Failing closed means: do not send, log the reason, surface it on the ticket. It must
never fall back to a partially-populated template or a blank variable.

Tracked as Phase 5.

---

## 6. Sequencing

1. **Size the 1Map contact coverage properly first** (issue #2292, step 1): a
   server-side run over a few hundred blank DRs. Everything below depends on the
   answer, and today it rests on a 12-DR sample at MEDIUM confidence (§2.2) —
   do not commit to a plan or a client conversation on that basis.
2. If coverage holds up, sync `contnr` (plus the `cell*` fallbacks) from the 1Map
   API into `onemap_properties`. On the current evidence this looks like the
   biggest single unlock, and it is ours to do rather than the FNO's — but that
   ranking is provisional until step 1 lands.
3. Negotiate §4 into the FNO agreement. Consent is required regardless of where the
   number comes from, and the FNO remains the only lawful source of that consent.
4. Submit §3 templates to Meta — they can sit approved indefinitely at no cost.
5. Build the Phase 5 preconditions.
6. Only then: set the `cloud_*` credentials, wire the Meta webhook, and flip
   `wa_provider` — all Hein-gated, via the Go Live tab.

## References

- [Pricing](https://developers.facebook.com/docs/whatsapp/pricing)
- [Getting opt-in](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in)
- [Policy and spam enforcement](https://developers.facebook.com/documentation/business-messaging/whatsapp/policy-enforcement)
- [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy)
