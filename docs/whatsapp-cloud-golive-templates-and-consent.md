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

## 2. Data readiness — measured, not assumed

Queried against the shared Supabase DB on 2026-07-28, last 90 days,
`COUNT(DISTINCT maintenance_tickets.id)`:

| Population | Tickets | Share |
|---|---|---|
| Tickets created | 4,125 | 100% |
| Have `client_contact` populated | 161 | 3.9% |
| Contact recoverable via `dr_number` → `onemap_properties.contact_number` | 785 | 19.0% |
| **No route to a subscriber number** | **~3,340** | **~81%** |

By source, `client_contact` is populated **only** on `pp_data` (161 of 1,606).
`wa_no_oes` (942), `manual` (937), `olt_mismatch` (394) and `snags` (245) carry
**zero** contacts. `dr_number` is far better populated (2,962 of 4,125).

**Conclusion: the subscriber's number is not in our data and cannot be derived from
it at usable coverage.** It has to arrive with the ticket, from the FNO — the same
party that must supply consent. Treat contact and consent as one ask.

### FNO attribution per ticket

The FNO *is* resolvable per ticket:

```
maintenance_tickets.project_id → public.projects.id::text
public.projects.client_id      → public.clients.company_name
```

Current values: `fibertime` (5,885 tickets), `Herotel Proprietary Limited` (37).
**But ~20% of current tickets have no `project_id`**, so no FNO can be named
(21.6% in July 2026; 9.8–30.8% across recent months). The templates below name the
appointing FNO in the first line, so an unresolved FNO must **block the send** — a
blank or wrong brand is worse than no message.

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

---

## 5. Outbound preconditions the code must enforce

Clause 3 is worthless if the send path does not enforce it. Every business-initiated
send must **fail closed** unless all four hold:

| # | Precondition | Why |
|---|---|---|
| 1 | Consent indicator present on the ticket | Meta opt-in policy + POPIA |
| 2 | Subscriber contact number present and SA-normalisable | 96% of tickets lack one today (§2) |
| 3 | FNO resolvable for the ticket | Template names the appointing party; ~20% unresolved |
| 4 | An approved template for the event type | Business-initiated cannot be free-form |

Failing closed means: do not send, log the reason, surface it on the ticket. It must
never fall back to a partially-populated template or a blank variable.

Tracked as Phase 5.

---

## 6. Sequencing

1. Negotiate §4 into the FNO agreement, with §2 as the evidence for why contact +
   consent must accompany every ticket.
2. Submit §3 templates to Meta — they can sit approved indefinitely at no cost.
3. Build the Phase 5 preconditions.
4. Only then: set the `cloud_*` credentials, wire the Meta webhook, and flip
   `wa_provider` — all Hein-gated, via the Go Live tab.

## References

- [Pricing](https://developers.facebook.com/docs/whatsapp/pricing)
- [Getting opt-in](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in)
- [Policy and spam enforcement](https://developers.facebook.com/documentation/business-messaging/whatsapp/policy-enforcement)
- [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy)
