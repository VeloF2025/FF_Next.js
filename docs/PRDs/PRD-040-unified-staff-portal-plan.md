# Plan — Unified staff portal: PWA hub + fleet SSO + payslips

## Context

Two parallel realities for phone-first staff today:

- **`/my`** — attendance portal. Phone + 6-digit PIN, clock in/out, corrections, history. Person-scoped. Shipped over the last 2 days (24 PRs).
- **`/fleet/portal`** — vehicle portal. License-plate photo (VLM) → vehicle identity → fuel / daily-check / weekly-check. Vehicle-scoped. In prod for months, already has its own service worker (`public/sw-fleet.js`) and offline queue.

Drivers who are ALSO attendance-tracked staff (every Velocity driver today) log in twice — once on `/my` to clock in, once on `/fleet/portal` to check in the vehicle. And `/my` will grow: payslips, future features. It needs to be a proper hub, not a single-feature screen.

Hein's decisions via AskUserQuestion (4 answers in order):

1. **First sprint = PWA hub infra** — service worker, home tile grid, install prompt. SSO bridge and payslips come in later phases.
2. **Contractor drivers are rare one-offs** — `/fleet/portal` plate-photo entry stays as a back-door but 95 % of traffic should go through `/my`. Eventually retire it if volume drops to zero.
3. **Payslips import from external payroll** — finance runs a payroll system (which one is TBD — see Open questions below). We import; we don't generate.
4. **Full installable PWA with service worker** — proper offline shell caching, add-to-home-screen prompt, same-level infra as `sw-fleet.js`.

Scope: Phases 1 + 2 + 3 are discrete PR streams. Phase 4 is polish/follow-up. Staff-side admin UIs (HR upload payslips, etc.) are in scope for the admin side of phase 3.

---

## Phase 1 — PWA hub infra (~1 week, ~5–7 PRs)

### Goal

Convert `/my` from "attendance-only portal" to "the staff phone hub". Installable to home screen. Tile grid on landing. Service worker caching the shell.

### What changes

#### 1.1 Service worker `public/sw-my.js`

Mirror `public/sw-fleet.js`. Cache names `my-portal-v1` + `my-offline-v1`. Pre-cache `/my`, `/my/attendance`, `/my/attendance/clock`, `/my/attendance/history`, `/my/attendance/corrections`, `/offline.html`, the VF logo SVG, manifest-my.json. Runtime cache the `/api/my/session` response with short TTL so returning to the app while offline doesn't immediately bounce you to login.

The existing offline clock-event queue (`src/modules/attendance/portal/client/offline/`) is not touched — it's its own IndexedDB layer and already works. The SW only adds shell caching on top.

#### 1.2 Registration hook `src/modules/attendance/portal/client/useServiceWorker.ts`

New, mirrors `src/modules/fleet/offline/useServiceWorker.ts`. Registers `/sw-my.js` at `scope: '/my/'`. Exposes `updateAvailable` flag so we can render an "update available, tap to reload" banner on the hub.

Register from `MyPortalShell` so the SW comes up on every /my page, not only the login.

#### 1.3 Tile-grid landing `pages/my/index.tsx` (after login) or `pages/my/attendance.tsx` → split

Currently `pages/my/attendance.tsx` is the post-login home. Either:

- **Option A**: Make `/my` itself the landing for signed-in users (`pages/my/index.tsx` becomes conditional: if no session → render login form; if session → render tile grid).
- **Option B**: Keep `/my` as login, keep `/my/attendance` as current home, add a `/my/home` tile page and redirect post-login to it.

**Recommendation: Option A.** Login form and hub coexisting in `pages/my/index.tsx` keeps URLs clean (`/my` is always "the hub") and avoids a gratuitous route. The login form renders behind a `!session` gate, the hub behind a `session` gate.

Hub tiles (order matters — most-used top):

```
┌─────────────────┐  ┌─────────────────┐
│ Clock           │  │ My Vehicle      │
│ 🕘 On shift     │  │ 🚗 VF-123-456   │
│ Since 07:12     │  │ Tap to check in │
└─────────────────┘  └─────────────────┘
┌─────────────────┐  ┌─────────────────┐
│ Payslips        │  │ Corrections     │
│ 📄 Latest: Mar  │  │ 📝 2 pending    │
└─────────────────┘  └─────────────────┘
┌─────────────────────────────────────┐
│ History (full-width tile)           │
└─────────────────────────────────────┘
```

Tile visibility rules (server-computed via new `/api/my/hub-summary` endpoint — see below):

- **Clock** — always shown.
- **My Vehicle** — shown only if `findActiveVehicleAssignment(staffId) !== null`. Tap → phase 2 auto-SSO into `/fleet/portal` with vehicle pre-selected. Until phase 2 ships, render as "Coming soon" greyed-out.
- **Payslips** — shown when at least one payslip row exists for the staff. Until phase 3 ships, render as "Coming soon".
- **Corrections** — always shown.
- **History** — always shown.

#### 1.4 Hub-summary endpoint `/api/my/hub-summary`

New GET endpoint. `withMySession`. Returns:

```ts
{
  openEntry: { clockInAt, durationMs } | null,
  assignedVehicle: { id, registration, lastCheckInAt } | null,
  latestPayslip: { period, url } | null,      // phase 3
  pendingCorrectionsCount: number,
  recentEntryCount: number
}
```

Used by the hub to render tile badges in one round-trip instead of four. Reuses `findOpenEntry`, `findActiveVehicleAssignment`, and corrections count queries.

#### 1.5 Install prompt

Small banner on `/my` landing (first visit only, dismissible, remembered in localStorage): "Install Velocity Fibre on your phone" with platform-specific instructions:

- **Chrome / Android** — trigger `beforeinstallprompt` programmatically on tap.
- **iOS Safari** — no programmatic install; show Share → Add to Home Screen screenshot with arrows.

Reuse platform detection from `GpsPermissionHelp.tsx` (we already have iOS Safari / Android Chrome / Desktop variants).

#### 1.6 Manifest update `public/manifest-my.json`

Verify icons (192 + 512 referenced from `/icons/`) resolve. Confirm `theme_color` matches the dark-neutral shell (currently `#1e40af` which is blue-700 — consider `#0a0a0a` to match `bg-neutral-950` + the CSS meta we set earlier). Add `display_override: ['window-controls-overlay', 'standalone']` for desktop PWA support.

### Files changed in Phase 1

| Path | Kind |
|---|---|
| `public/sw-my.js` | NEW |
| `public/manifest-my.json` | MOD (theme color + display_override) |
| `src/modules/attendance/portal/client/useServiceWorker.ts` | NEW (mirror of fleet) |
| `src/modules/attendance/portal/client/MyPortalShell.tsx` | MOD (register SW) |
| `src/modules/attendance/portal/client/InstallPrompt.tsx` | NEW |
| `pages/my/index.tsx` | MOD (tile-grid hub when logged in) |
| `pages/api/my/hub-summary.ts` | NEW |
| `pages/my/attendance.tsx` | Keep as-is (deep-link target from Clock tile) |

### Verification — Phase 1

- `npm run ci:quick` passes.
- Service worker registers cleanly on `dev.fibreflow.app/my` (verify via DevTools → Application → Service Workers).
- Offline test: load `/my` on phone, airplane mode, refresh — shell loads from cache, shows "offline" banner, clock-event queue still functions via the existing `submitClockEventWithOfflineFallback`.
- Add-to-Home-Screen works on Android Chrome (programmatic prompt) and iOS Safari (via Share menu). Installed app opens in standalone mode with VF icon.
- Tile badges update correctly after clock-in, clock-out, submitting a correction.

### Phase 1 risks

- **Service worker caching stale HTML** — mitigate with skip-waiting + "update available" banner on version bump. Same pattern `sw-fleet.js` already uses.
- **iOS Safari install prompt is manual** — UX has to be good enough that people find Share → Add to Home Screen without hand-holding. Worst case: screenshot-based tutorial.

---

## Phase 2 — SSO bridge (`/my` ↔ `/fleet/portal`) (~1 week, ~3 PRs)

### Goal

A /my-authenticated staff member with an assigned vehicle tapping "My Vehicle" on the hub → lands directly in `/fleet/portal` with their vehicle pre-selected, **no plate-photo, no second login**.

### What changes

#### 2.1 Bridge middleware in `/fleet/*` auth layer

`src/lib/auth/middleware.ts` `fleetAuth` currently accepts `user` session OR `portalSession` from `ff_portal_session`. Add a third branch: `ff_my_session` with an active vehicle assignment.

When a request arrives with `ff_my_session`:
1. Verify it via the existing `verifySessionCookie` helper in `src/modules/attendance/portal/sessionUtils.ts`.
2. Look up the active vehicle assignment via `findActiveVehicleAssignment(session.staffId)`.
3. If present, synthesize an equivalent `portalSession`-shaped object and hand it to the route.
4. If absent (no vehicle), reject with a clear error — they shouldn't be in `/fleet/portal` via this path.

No new DB write. No new cookie. The `/my` session becomes authoritative identity; the fleet-side synthesizes its expected session shape on the fly.

#### 2.2 Retain plate-photo as first-class entry

For **contractor drivers** (no `/my` account), the existing plate-photo bootstrap at `/fleet/portal` continues to work exactly as today. They don't see the new flow.

#### 2.3 Hub tile routing

"My Vehicle" tile on `/my` (the disabled tile from phase 1) gets enabled. Tapping it does `router.push('/fleet/portal?from=my')`. The query param is optional — just for telemetry.

The `/fleet/portal` page code gets a tiny branch: if the incoming request was authenticated via the `/my`-session bridge, skip the plate-photo UI and go straight to the action selection (Fuel / Daily / Weekly) with the vehicle already resolved. Implementation is one `if` gate on `portalSession.source === 'my'` (new field we add in step 2.1 so the UI can branch).

### Files changed in Phase 2

| Path | Kind |
|---|---|
| `src/lib/auth/middleware.ts` | MOD (add my-session bridge branch in `fleetAuth`) |
| `src/modules/fleet/portal/types.ts` | MOD (`source: 'plate' \| 'my'` on PortalSession) |
| `pages/fleet/portal.tsx` | MOD (skip plate UI when source=my) |
| `pages/my/index.tsx` | MOD (enable My Vehicle tile) |

### Verification — Phase 2

- Manual E2E: log into `/my` with phone+PIN, tap My Vehicle tile → lands on `/fleet/portal` with the correct assigned vehicle, no plate photo prompt.
- Contractor flow regression: open `/fleet/portal` in an incognito tab (no `/my` cookie), plate photo still works as today.
- DB: no new tables or columns.
- Security: staff without an active vehicle assignment hitting `/fleet/*` directly still get rejected with a clean 403.

### Phase 2 risks

- **Security: vehicle mis-assignment**. If the assignment table is stale, a staff member could see a vehicle that's been reallocated. Mitigation: `findActiveVehicleAssignment` already filters on `is_active = true`; the assignment state is authoritative.
- **Contractor regression**. Every line of this branch must be guarded by the `ff_my_session` presence check; plate-photo path cannot be affected.

---

## Phase 3 — Payslips (~2 weeks, ~4–6 PRs)

### Goal

Staff see their monthly payslip on `/my/payslips`. Payslips land via an HR-side import from the external payroll system.

### Open question (blocks phase 3 start)

**Which payroll system does Velocity use?** Options with SA-relevant context:

| System | How we'd import | Notes |
|---|---|---|
| **Sage Business Cloud Payroll** | SA Basic Auth API (we already have Sage integration knowledge — see `project_accounting_app.md` memory reference) | Highest reuse potential |
| **SimplePay (SA)** | REST API with token auth, supports payslip export | Common SA SMB choice |
| **VIP Payroll (Sage VIP)** | CSV export; no API on the desktop edition | Manual-upload path only |
| **Manual CSV / PDF upload** | HR uploads a monthly file to an admin page | Works today for any payroll; lowest friction |
| **Other** | — | Flag and we'll scope |

**Recommendation**: build **manual CSV/PDF upload first** (works regardless of payroll system; HR drops a file, we parse), then if finance commits to Sage or SimplePay, add a scheduled API pull later. This avoids blocking phase 3 on finance's software choice.

### What changes (assuming CSV-first path)

#### 3.1 DB migration — `payslips` table

```sql
CREATE TABLE payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id),
  pay_period_start DATE NOT NULL,    -- e.g. 2026-04-01
  pay_period_end   DATE NOT NULL,    -- e.g. 2026-04-30
  gross_cents BIGINT NOT NULL,
  deductions_cents BIGINT NOT NULL,
  net_cents BIGINT NOT NULL,
  pdf_url TEXT,                      -- VF Storage path if HR uploaded a PDF
  raw_data JSONB,                    -- line items from CSV for detailed view
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_by UUID REFERENCES staff(id),
  UNIQUE (staff_id, pay_period_start, pay_period_end)
);
```

POPIA: payslips are personal financial data. Access gated by staff_id match (staff sees own) or manager role (HR/finance sees all).

#### 3.2 Admin-side upload page `pages/staff/payslips/import.tsx`

HR-only (`withPermission('payslips.import')`, new permission seed). Uploads:
- **PDF bundle**: a single file matching a staff_id + period via filename convention (e.g. `ac59fe41-...-2026-04.pdf`).
- **CSV summary**: one row per staff with gross/deductions/net + period.

Server-side validator: both files must align. Preview shows "17 payslips ready to import, 2 unmatched (click to resolve)" before commit.

#### 3.3 Staff-side viewer `pages/my/payslips/index.tsx`

List of payslips, latest first. Each row: period, gross/net, "Download PDF" button. `withMySession` + staff_id filter.

PDF download: signed short-lived URL from VF Storage, per-request, 1-min TTL, logged for POPIA access audit.

#### 3.4 Hub tile

"Payslips" tile from phase 1 activates. Badge: "Latest: Apr 2026". Tap → `/my/payslips`.

### Files changed in Phase 3

| Path | Kind |
|---|---|
| `scripts/migrations/sql/326_payslips.sql` (or next available number) | NEW |
| `pages/api/my/payslips/index.ts` | NEW |
| `pages/api/my/payslips/[id]/download.ts` | NEW |
| `pages/api/staff/payslips/import.ts` | NEW |
| `pages/my/payslips/index.tsx` | NEW |
| `pages/staff/payslips/import.tsx` | NEW |
| `src/modules/payslips/` | NEW module (queries, CSV parser, PDF matcher, permissions) |
| `pages/my/index.tsx` | MOD (enable Payslips tile) |

### Verification — Phase 3

- Admin can upload a CSV + PDF bundle; validator catches mismatches; commit inserts rows.
- Staff sees only own payslips on `/my/payslips`.
- Direct API access to another staff's payslip returns 403.
- PDF download URL expires; second use after 1 min returns 401.
- POPIA audit table records every view/download.

---

## Phase 4 — Polish (rolling, no sprint)

- Real installable-PWA QA across iOS Safari, Android Chrome, desktop Edge.
- WCAG AA audit on all `/my` pages (we're likely close after today's dark-theme work).
- Tap-target compliance sweep (44×44 iOS HIG minimum; some of our buttons are 32px today — e.g. method-toggle tabs on login, flagged in #1428 review).
- Expand hub tile grid as new features ship (leave requests, H&S incidents, etc.).

---

## Cross-phase architectural decisions

### Session strategy — NO unified cookie

Confirmed: we will NOT merge `ff_my_session` and `ff_portal_session` into one cookie. The SSO bridge in phase 2 is one-directional (my-session grants fleet access) without touching the fleet cookie shape. Rationale: the two audiences have genuinely different identity models (person vs vehicle) and a shared cookie complicates the contractor path.

### Admin/office FibreFlow stays separate

The main app (dashboards, NOC, procurement, etc.) uses its own NextAuth-style session. Nothing in this plan touches it. Office staff who happen to also be paid employees log in twice — once to FibreFlow admin, once to `/my`. That's acceptable; the office audience is small and already used to admin creds.

### Failure isolation

Each phase has its own kill switch:
- Phase 1 SW breaks → unregister at `/my`, revert to non-PWA behaviour. Users don't lose clock-in (IndexedDB queue is independent).
- Phase 2 bridge breaks → users see plate-photo flow again. Fleet portal keeps working.
- Phase 3 payslip import breaks → tile stays "Coming soon", no clock-in impact.

---

## Critical files already in repo we'll reuse

| File | What we reuse |
|---|---|
| `public/sw-fleet.js` | Template for `sw-my.js` |
| `src/modules/fleet/offline/useServiceWorker.ts` | Template for the /my SW registration hook |
| `src/modules/attendance/portal/sessionUtils.ts` | `verifySessionCookie`, `MY_SESSION_COOKIE` — used by phase 2 bridge |
| `src/modules/attendance/portal/clockUtils.ts` | `findOpenEntry`, `findActiveVehicleAssignment` — hub tile summary |
| `src/lib/auth/middleware.ts` | `fleetAuth` — phase 2 bridge branch added here |
| `src/modules/fleet/portal/types.ts` | `PortalSession` — add `source` discriminator |
| `pages/fleet/portal.tsx` | Skip plate-photo branch when `source: 'my'` |
| `public/manifest-my.json` | Already scoped to `/my`; needs theme + display tweaks |

---

## Questions still open before phase 3

1. **Which payroll system?** Decide between Sage Business Cloud, SimplePay, VIP, or CSV-first.
2. **Payslip PDF provenance** — does HR today already produce a per-staff PDF, or only a payroll report? Changes the admin-import UX.
3. **POPIA retention** — how long do we keep imported payslips? SA labour law minimum is 3 years; Velocity policy may be longer.
4. **Historical payslips** — back-import past 12 months on day one, or start fresh?

These don't block phase 1 or 2. We can pick them up when phase 3 is next.

---

## Rollout sequence

1. **Phase 1 complete + dogfooded** — Hein + 1–2 office staff use the installed PWA on personal phones for a week. Iterate on UX.
2. **Phase 2 bridge shipped** — drivers who are also staff test SSO. Contractor path regression-tested.
3. **Phase 3 payslip import admin-side** — HR trained on the import workflow. First real monthly import.
4. **Phase 3 staff-side launch** — announce `/my/payslips` to the whole company.

Total calendar time if nothing surprises: ~4–5 weeks. Each phase is mergeable, deployable, and independently valuable.
