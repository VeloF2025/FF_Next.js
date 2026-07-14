# Procurement Mobile Approvals — Design Spec

- **Date:** 2026-07-13
- **Status:** Draft (awaiting review)
- **Author:** Claude (brainstormed with Hein)
- **Trigger:** Lew reported that on mobile the PO approvals page pushed the Approve button off-screen (fixed separately in PR #2151). That surfaced a broader ask: procurement doesn't work well for **approvers on the go**.

---

## 1. Problem & Goal

Procurement is an 8-category desktop back-office module. The only part people genuinely need on a phone is **approving things while away from a desk**: a manager/director gets pinged that a PO (or requisition, payment request, etc.) needs sign-off, opens it on their phone, reviews it, and Approves / Rejects / Parks it.

Today that flow is broken on mobile: the entity detail pages are desktop layouts squished into a phone (the PO header clipped the action buttons — now fixed), and there is no purpose-built mobile approval experience.

**Goal:** A mobile-first, deep-linkable **approval-review surface** that lets an authenticated approver open any pending approval on their phone, review enough detail to decide, and act — reusing the existing unified approvals backend.

### Non-goals (explicitly out of scope for this effort)
- Mobile-optimising the rest of procurement (BOQ building, RFQ creation, stock management, reports). Those stay desktop.
- New notification infrastructure (auto-generated links, WhatsApp hooks, push). Links are shared manually in v1. (Auto-links/push is a clearly-marked later phase.)
- Tokenized no-login approval links (rejected on security grounds — see §5).
- Changing the approval **rules/workflow engine** (`approval_workflows` / `approval_levels`). We consume it as-is.

### Success criteria
- An approver can tap a link on their phone, authenticate, and land directly on the specific approval item.
- They can review the item's key detail (rich for PO/requisition) and Approve / Reject (with reason) / Park (with reason) from a thumb-reachable action bar, with no horizontal overflow or clipped controls at 360–430px widths.
- Works for all 7 workflow types (rich detail for PO + requisition; summary + "open full record" for the other five).
- The desktop approvals experience is unchanged (only additively improved).

---

## 2. Users & Primary Flow

**User:** Managers/directors who hold approval authority. They have real RBAC accounts (NOT `/my` PIN-based field staff).

**Primary flow (deep link from a ping):**
```
WhatsApp/email: "PO-2026-0161 needs approval" + link
  → tap link (cold browser on phone)
  → RBAC login (if not already authenticated) → redirect back to the item
  → mobile approval-review screen: type badge, document #, amount, requester, due/overdue
      + type-aware detail (PO → line items, supplier, totals, docs)
  → sticky action bar: [ Reject ]  [ Park ]  [ Approve ]
  → Reject/Park open a bottom-sheet for the required reason
  → on success: confirmation + item leaves the pending set
```

**Secondary flow (browse the inbox):** open `/procurement/approvals` on a phone → mobile-first list of pending items → tap one → same review screen.

---

## 3. Chosen Approach — Unified Mobile Approval-Review Surface (Approach A)

One deep-linkable mobile route driven by the **existing unified `approval_requests` model**, with a **type-aware detail panel** and a **shared sticky action bar**. Build the shell + action bar once; it covers all 7 workflow types. Per-type detail richness is incremental.

### Why not the alternatives
- **B — mobile-ify each entity's detail page in place:** Only 2 of 7 detail pages exist (PO 1039 lines, requisition 1143 lines); the other 5 (`boq`, `rfq`, `goods_receipt`, `supplier_registration`, `payment_request`) have no detail page. B means building 5 new pages plus mobile-tuning 2 large ones, with 7 duplicated action bars and inconsistent UX. Most work, least consistency.
- **C — summary-only inbox with inline approve:** Smallest, but the approver can't see line items before signing off — exactly what made Lew open the full PO. Too thin for high-value sign-off.
- **A contains C:** the summary card is A's fallback panel for types without a rich read API, so A is strictly more capable at similar risk.

### What already exists (reused, not rebuilt)
- **Data:** `approval_requests` (+ `approval_workflows`, `approval_levels`) with columns: `id, document_type, document_id, document_number, document_amount, status, requested_by(_name), requested_at, request_notes, assigned_to(_name), responded_by(_name), responded_at, response_notes, due_date, is_overdue, parked_*, park_reason` + joined `workflow_name`, `level_name/number`, `approver_type/role/user`.
- **List APIs:** `GET /api/procurement/approvals/all`, `GET /api/procurement/approvals/pending`.
- **Action APIs:** `POST /api/procurement/approvals/[id]/approve | reject | park | resume` (all `withAuth`).
- **Per-entity read APIs** for rich panels: e.g. `GET /api/procurement/purchase-orders/[id]` (items, supplier, docs), requisition read via `/api/procurement/requisitions/[id]`.
- **Desktop queue:** `pages/procurement/approvals/index.tsx` (already lists all types + approve/reject/park/resume).

---

## 4. Architecture & Component Units

### 4.1 Routes
- **`/procurement/approvals/[requestId]`** — NEW. The deep-link target and review screen. `requestId` = `approval_requests.id` (stable, type-agnostic — a single URL shape for all 7 types).
- **`/procurement/approvals`** — EXISTING. Gets a mobile-first pass (responsive list; no functional change to actions).

### 4.2 Layout
Render the detail route in a **lightweight mobile layout** (minimal top bar with back + title, no desktop sidebar chrome), not the full `AppLayout`, so the screen is focused on review + action. Desktop viewport still gets a comfortable centered column. (Reuse `AppLayout` only if a slim variant is cheap; otherwise a small dedicated layout wrapper.)

### 4.3 Component units (each independently testable)
| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `MobileApprovalScreen` (page) | Fetch the approval_request by id, orchestrate header + panel + action bar, handle action results | approvals read API |
| `ApprovalSummaryHeader` | Type badge, document #, amount, requester, requested-at, due/overdue, current level | approval_request record |
| `ApprovalDetailPanel` (registry) | Renders type-specific detail; picks a renderer by `document_type` | per-type read APIs |
| ↳ `PurchaseOrderPanel` | Line items, supplier, totals, document checklist | `GET .../purchase-orders/[id]` |
| ↳ `RequisitionPanel` | Line items, requester, project | `GET .../requisitions/[id]` |
| ↳ `SummaryFallbackPanel` | For the other 5 types: shows summary + "Open full record" link | approval_request only |
| `ApprovalActionBar` | Sticky bottom bar: Reject / Park / Approve; disabled during in-flight; hides when not actionable | action APIs |
| `ReasonBottomSheet` | Mobile sheet capturing the required reason for Reject/Park (replaces the desktop `prompt()`) | — |

**Renderer registry:** a `Record<WorkflowType, PanelComponent>` with `SummaryFallbackPanel` as the default. Adding a rich panel later = one map entry; no changes to the shell. This is the seam that makes "all 7 types now, richer later" cheap.

### 4.4 Data flow
1. Page loads `GET /api/procurement/approvals/[requestId]` (NEW single-item read — see §7 open items; may need adding, or derive from `all`/`pending`).
2. `ApprovalDetailPanel` looks up `document_type` → if a rich panel exists, it fetches that entity's read API using `document_id`; else renders `SummaryFallbackPanel`.
3. Action bar posts to the existing `approve|reject|park` endpoint with `{ notes }`; on success, show confirmation and navigate back to the inbox (or a "done" state).

---

## 5. Auth & Deep-Link

- **RBAC login + redirect-back.** Cold tap → if unauthenticated, send to login with the original URL preserved, then return to `/procurement/approvals/[requestId]`. **No existing return-URL mechanism was found** (login is `/api/auth/login`; page-level redirect not located) — so a small, well-scoped addition (a `?redirect=` / `returnTo` param honored by the login flow, validated to same-origin relative paths) is expected work in Phase 1. **This is the top delivery risk** and must be validated early.
- **No tokenized no-login links.** Approvals require an auditable "who approved" and must not be actionable by anyone who receives a forwarded link.
- **Authorization (security item):** `approve.ts` runs under `withAuth` and stamps `responded_by = userId`, but does **not** appear to verify the caller is the *assigned* approver / holds the required role/level. This is pre-existing (the desktop queue shares the endpoint), but exposing a clean deep link makes it easier to hit an arbitrary `requestId`. The plan must (a) confirm current behavior, and (b) add an eligibility check (caller matches `assigned_to`, or holds `approver_role`, for the current `level`) before writing the response — server-side, not just hiding the button. Treated as a MUST in Phase 1 hardening.

---

## 6. Error / Edge Handling
- **Already actioned / stale:** if `status != pending` (someone else approved, or it was rejected/cancelled) → show the resolved state read-only; action bar hidden.
- **Not an eligible approver:** action bar hidden + explanatory note; server rejects the action defensively (see §5).
- **Wrong level / escalated:** show current level; only enable action if the caller is the current-level approver.
- **Entity read fails** (rich panel API 404/500): degrade to `SummaryFallbackPanel` — never block the decision on the optional detail fetch.
- **Offline:** approvals are decisive server actions — do NOT queue offline. Show a clear "you're offline, reconnect to approve" state. (Distinct from the `/my` offline-capture pattern; approvals need immediate server confirmation.)
- **Double-submit:** disable the action bar while a request is in flight; rely on server status guard for idempotency.

---

## 7. Open Items to Resolve in the Plan
1. **Single-item read endpoint:** is there a `GET /api/procurement/approvals/[id]`? If not, add one (or scope a lightweight read from the existing `all`/`pending` query) so the deep link can load one request by id.
2. **Login redirect-back:** confirm how unauthenticated page loads currently behave; design the `returnTo` param (same-origin validated). **Validate first.**
3. **Approve authorization:** confirm/har­den eligibility check in `approve|reject|park`.
4. **Requisition read API shape:** confirm `/api/procurement/requisitions/[id]` returns line items suitable for the panel.
5. **Layout choice:** slim variant of `AppLayout` vs a small dedicated mobile layout wrapper.
6. **Assigned-approver display:** `approver_type` can be `user | role | department_head | project_manager | any_of_group` — the header should render this sensibly.

---

## 8. Phasing
- **Phase 1 (MVP, deployable):** unified detail route + slim layout + `ApprovalSummaryHeader` + `PurchaseOrderPanel` + `RequisitionPanel` + `SummaryFallbackPanel` (covers the other 5) + `ApprovalActionBar` + `ReasonBottomSheet`; single-item read endpoint; login redirect-back; approve-eligibility hardening; mobile-first pass on the `/procurement/approvals` inbox.
- **Phase 2:** rich panels for the remaining types as demand shows (payment_request, goods_receipt, rfq, supplier_registration, boq).
- **Phase 3 (optional):** auto-generated share links + push notifications (needs infra; separate spec).

---

## 9. Testing
- **Unit:** renderer registry (type → panel, fallback default); action-bar state machine (in-flight disable, hidden-when-not-actionable); reason sheet validation (reject/park require non-empty reason).
- **Server:** approve/reject/park eligibility guard (eligible approver succeeds; non-eligible 403; already-actioned 409); single-item read.
- **Browser E2E (mobile viewport, per CLAUDE.md rule 4):** deep link → login redirect-back → review → Approve; and → Reject with reason. Assert no horizontal overflow and action bar reachable at 360/390/430px. Use the project's established mobile E2E method.
