# Main App PWA — Phase 0 Foundation + Pilot Write Workflow

**Date:** 2026-07-03
**Branch:** `feat/main-app-pwa`
**Status:** Draft — awaiting Hein's review
**Author:** Claude (brainstorming session with Hein)

---

## 1. Problem & Goal

Mobile users should be able to *work* in the main FibreFlow app (`/`) — install it to
their home screen, keep using it through poor/no signal, and capture data offline that
syncs when connectivity returns.

Today the main app is **not a PWA at all**:

- `public/manifest.json` exists but is **not referenced** anywhere — `pages/_document.tsx`
  links `icon` and `apple-touch-icon` but has **no `<link rel="manifest">`**. So the app
  is not installable.
- `pages/_app.tsx` registers **no service worker** for the main app. There is no offline
  shell, no runtime caching, no update prompt.
- Three separate, hand-rolled PWA stacks already exist for sub-surfaces, each with its own
  manifest + service worker + offline queue:
  - `/my` staff portal — `manifest-my.json`, `sw-my.js`, IndexedDB clock-event queue
    (`src/modules/attendance/portal/client/offline/`)
  - Field stock — `sw-stock.js`, `src/modules/field-stock/offline/`
  - Fleet — `sw-fleet.js`, `src/modules/fleet/offline/`

The fragmentation is the opportunity: the `/my` clock-event queue is a **mature, tested,
battle-scarred** offline-write engine. Phase 0 generalises it into one shared primitive so
the main app — and eventually all sub-surfaces — stop reinventing offline sync.

### Program shape (agreed in brainstorming)

Making the *whole* main app offline-writable is not one spec. The program is decomposed:

| Phase | Scope |
|-------|-------|
| **Phase 0 (this doc)** | Installable shell + app-wide offline *read* + the reusable **offline-write queue library** + **one pilot** write workflow proving the stack end-to-end |
| Phase 1 | Activations / DR offline capture (queue consumer) |
| Phase 2 | Snags create/resolve offline (queue consumer) |
| Phase 3 | NOC ticket updates offline (queue consumer) |

Each later phase is its own spec → plan → PR and merely plugs into the Phase 0 queue.

---

## 2. Goals & Non-Goals

### Goals (Phase 0)

1. **Installable main app.** `/` is installable to home screen, launches standalone, has a
   real manifest with proper maskable 192/512 icons and an unobtrusive Add-to-Home-Screen
   affordance.
2. **Offline shell + offline read.** A root service worker precaches/render-caches the app
   shell, serves a graceful offline fallback on navigation, and runtime-caches visited
   pages + safe GET APIs (stale-while-revalidate) so recently-seen data renders offline.
3. **Reusable offline-write queue library** (`src/lib/offline-queue/`) — a generic,
   endpoint-agnostic generalisation of the proven attendance queue: enqueue → flush on
   reconnect → retry/backoff → conservative drain classification → dropped-record
   persistence for dispute/visibility.
4. **One pilot consumer** wired onto the library end-to-end, proving correctness before we
   replicate it three more times.
5. **Update UX.** When a new SW/app version ships, the user is prompted to reload (reusing
   the existing `VersionChecker` mechanism where possible).
6. **Non-regression.** The existing `/my`, field-stock, and fleet PWAs keep working exactly
   as before.

### Non-Goals (explicitly deferred — YAGNI)

- Migrating `/my`, field-stock, or fleet onto the new library (they work; leave them). The
  library is designed so they *can* migrate later, but Phase 0 does not touch them.
- Offline write for Activations, Snags, NOC (Phases 1–3).
- Push notifications.
- True precache-everything offline-first for *every* route (runtime caching covers the
  realistic field need; full precache is a later enhancement if measured to be needed).
- Any change to the server-side APIs beyond what the pilot strictly requires.

---

## 3. Architecture

Three independent layers, plus the pilot. Each is separately testable.

```
┌───────────────────────────────────────────────────────────────────┐
│ Layer A — Installability (declarative)                            │
│   manifest.json (rewritten) · maskable icons · _document/_app head │
│   · InstallPrompt component (beforeinstallprompt)                  │
├───────────────────────────────────────────────────────────────────┤
│ Layer B — Root Service Worker  (public/sw-app.js, scope '/')      │
│   · app-shell + offline.html navigation fallback                   │
│   · runtime read-cache (SWR) for pages + allowlisted GET APIs      │
│   · SKIP_WAITING / update messaging                                │
│   · SCOPE ARBITRATION: ignores /my, /stock, /fleet sub-scopes      │
├───────────────────────────────────────────────────────────────────┤
│ Layer C — Offline-Write Queue Library  (src/lib/offline-queue/)   │
│   · generic IndexedDB pending + dropped stores                     │
│   · pure flush engine w/ hooks + drain classifier                  │
│   · React hook: useOfflineQueue(config)                            │
│   · page-context flush on `online` + interval (NOT SW Bg-Sync)     │
└───────────────────────────────────────────────────────────────────┤
│ Pilot — one workflow consumes Layer C                             │
└───────────────────────────────────────────────────────────────────┘
```

### 3.1 Layer A — Installability

- **Rewrite `public/manifest.json`**: keep `name`/`short_name`/`theme_color`, but add
  proper PNG icons at **192×192** and **512×512** (both `any` and a `maskable` variant).
  The current manifest only ships a 16px favicon + an SVG, which most Android installers
  reject for the home-screen icon. New icons generated from the existing brand SVG/logo.
- **Wire the manifest in**: add `<link rel="manifest" href="/manifest.json">` +
  `theme-color` meta + apple PWA meta tags to `pages/_document.tsx` (currently missing).
- **`InstallPrompt` component** (`src/components/pwa/InstallPrompt.tsx`): captures the
  `beforeinstallprompt` event, shows a dismissible "Install FibreFlow" affordance on
  mobile, respects a "don't ask again" flag in localStorage. Rendered from `_app.tsx`.
- **Scope note:** the root manifest uses `scope: '/'`, `start_url: '/'`. The `/my` manifest
  (`manifest-my.json`, `scope: '/my'`) continues to be linked only within `MyPortalShell`,
  so `/my` remains its own installable app. Both can coexist.

### 3.2 Layer B — Root Service Worker (`public/sw-app.js`)

Hand-rolled, mirroring the proven `sw-my.js` structure (install/activate/fetch/message),
but scoped to the **whole app minus the sub-scopes that already own a SW**.

- **Registration**: a new `useAppServiceWorker()` hook (modelled on the existing
  `useServiceWorker.ts`) called from `_app.tsx`, registering `/sw-app.js` at scope `/`.
- **Scope arbitration (critical):** a SW registered at `/` controls *all* pages, including
  `/my`, `/stock/portal`, and fleet routes — which already have their own SWs. To avoid two
  SWs fighting over the same page, `sw-app.js`'s `fetch` handler **early-returns (does
  nothing) for any URL under the reserved sub-scopes** (`/my`, field-stock portal, fleet
  routes, and their `manifest-*.json`/`sw-*.js` assets). Those pages keep being handled by
  their own more-specific registrations. `sw-app.js` only ever caches/serves the rest.
  (Registration precedence: the browser routes a page to the **most specific** matching
  registration, so `/my` → `sw-my.js`; the early-return is defence-in-depth.)
- **Install**: precache a minimal shell — `/offline.html`, the root document, core brand
  assets. Deliberately *not* the hashed `/_next/static` chunks (those are runtime-cached;
  see approach decision §5).
- **Fetch strategy**:
  - Navigations: network-first → cache fallback → `/offline.html`.
  - Static assets (`.js/.css/.woff2/...` under `/_next/static`, images): cache-first with
    background refresh.
  - Allowlisted **GET** APIs: stale-while-revalidate with a short TTL. Allowlist starts
    empty/minimal and is grown deliberately — never blanket-cache `/api/*` (auth, mutations,
    and per-user data must not be cross-served).
  - **Never** touch non-GET requests (mutations always go to the network or the Layer C
    queue).
- **Update messaging**: `SKIP_WAITING` handler + posts a message the app surfaces as a
  "new version available — reload" prompt, coordinated with `VersionChecker`.
- **Versioned cache names** (`app-shell-v1`, `app-runtime-v1`) with activate-time cleanup
  of stale versions (same pattern as `sw-my.js`).

### 3.3 Layer C — Offline-Write Queue Library (`src/lib/offline-queue/`)

A direct generalisation of `src/modules/attendance/portal/client/offline/`. That code is
the reference implementation; we lift its **shape** and hard-won policies into a generic,
typed, config-driven module.

**Public surface:**

```ts
// A queue is defined once per workflow by a config object.
interface OfflineQueueConfig<TPayload> {
  queueName: string;                    // → IndexedDB DB name, must be unique per workflow
  maxQueueSize?: number;                // default 50 (from attendance)
  maxAttemptsBeforeDrain?: number;      // default 10
  submit: (payload: TPayload) => Promise<Response>;   // the network call
  classify: (err: unknown, payload: TPayload) => SubmitResult; // drain vs keep
}

interface QueuedItem<TPayload> {
  id: string; payload: TPayload;
  queuedAt: string; attempts: number; lastError?: string;
}

interface SubmitResult { drain: boolean; errorMessage?: string }

// Storage (generic port of db.ts): pending + dropped stores, size cap,
// QueueFullError, race-safe attempts bump, dropped-record retention.
class OfflineQueueStore<TPayload> { enqueue / list / count / delete / bumpAttempts / drop / listDropped / acknowledgeDropped }

// Pure flush engine (generic port of sync.ts): flushQueue(items, submit, hooks)
// with onDrain / onTransient / onAbandon hooks + the conservative early-exit-on-transient policy.

// React hook wiring it to the page lifecycle:
function useOfflineQueue<TPayload>(config): {
  enqueue(payload): Promise<void>;
  pendingCount: number;
  dropped: QueuedItem<TPayload>[];
  flush(): Promise<FlushReport>;
  acknowledgeDropped(id): Promise<void>;
}
```

**Preserved policies (these are the lessons, not incidental code):**

- **Conservative draining** — keep by default; only drain on an explicit allowlist of
  unrecoverable reasons. A new/unknown server 4xx is *kept and retried*, never silently
  dropped (this reversed a real lost-shift bug in attendance).
- **Dropped-record store** — permanently-failed items are moved to a `dropped` store (not
  deleted) so the user/supervisor can see and dispute them; UI acknowledges to clear.
- **Attempts cap safety valve** (`maxAttemptsBeforeDrain`) so one corrupt row can't wedge
  the queue forever.
- **Queue-depth cap** (`QueueFullError`) so a phone out of range for weeks can't silently
  blow IndexedDB quota; the UI must handle the typed error.
- **Flush from the page context** on the `online` event + a low-frequency interval — NOT
  the SW Background Sync API. The attendance module deliberately does this; Background Sync
  has patchy support and unpredictable firing. Layer C stays independent of Layer B so it
  works even where the root SW is disabled.
- **Race-safe attempts bump** via read-modify-write inside one IDB transaction.

**Serialisation note:** payloads may include images. Following attendance
(`selfieBase64`), Phase 0 stores image payloads as base64/Blob in IndexedDB. Large-photo
workflows (Activations) will validate quota headroom in their own phase.

### 3.4 Pilot — proving Layer C

The pilot is **one** real workflow wired onto `useOfflineQueue`, with:
- offline capture → enqueue,
- a visible pending-count + "syncing…" indicator,
- a "recently dropped" list the user can acknowledge,
- flush on reconnect,
- tests for enqueue, flush success, transient-keep, and permanent-drain paths.

**Recommended pilot: Snags create/resolve** *(revised from the brainstorming pick).*

During grounding I found the Works QA module's mutating endpoints (`photo-approve`,
`pole-approve`, `pole-comment`, `pole-snag-report`, `photo-snag-resolve`) are largely
**reviewer/approval actions**, and raw field photo capture enters via QField/SharePoint
ingestion rather than a direct in-app submit. That makes Works QA writes more desk-side
than poor-signal field work — a weaker proof of an *offline field-write* primitive.

**Snags create/resolve** is a cleaner first consumer: an on-site user raises/resolves a
snag with a photo and a few fields, which is exactly the "capture in the field, sync later"
shape the library exists for. **This is an open decision for Hein (see §7).** The Phase 0
foundation (Layers A/B/C) is identical regardless of pilot choice; only §3.4's consumer
changes.

---

## 4. Data Flow

**Offline write (pilot):**
```
User submits (offline) → useOfflineQueue.enqueue(payload)
  → OfflineQueueStore.enqueue → IndexedDB 'pending'  (QueueFullError if >50)
  → UI shows pending count
[reconnect / interval] → flush()
  → flushQueue(pending, config.submit, hooks)
      success            → delete from pending
      transient (5xx/429/network/401) → bumpAttempts, keep, early-exit
      permanent (allowlisted 4xx)     → drop → 'dropped' store (visible to user)
      attempts ≥ cap                  → abandon → 'dropped' store
```

**Offline read (Layer B):**
```
Navigation online  → network → cache copy → render
Navigation offline → cache hit → render;  miss → /offline.html
GET API (allowlisted) → cache copy returned immediately, network refresh in background
```

---

## 5. Approach Decision (needs Hein's sign-off)

**How to build Layer B's shell caching:** hand-rolled vs a build-time PWA toolkit
(`next-pwa` / Serwist/Workbox).

| | Hand-rolled `sw-app.js` (recommended) | Serwist / next-pwa |
|---|---|---|
| Consistency | Matches the 3 existing hand-rolled SWs | New paradigm alongside 3 hand-rolled SWs |
| Dependencies | None | New build-time dep + webpack/Next integration |
| Offline-first depth | Runtime cache (visited routes work offline) | Build-time precache of *all* `/_next` chunks (any route works offline first-visit) |
| Cache-invalidation risk | We own it (but `sw-my` already proves the pattern) | Toolkit handles it |
| Coexistence w/ module SWs | Full control of scope arbitration | Must configure around existing SWs |

**Recommendation: hand-rolled `sw-app.js`.** Rationale:

1. The *actual* "work offline" requirement is Layer C (write queue), which needs **no**
   toolkit — the proven attendance pattern flushes from page context, not SW Background
   Sync.
2. Layer B's read-caching need (visited routes render offline) is fully met by the runtime
   SWR pattern `sw-my.js` already runs in production.
3. Consistency with the existing three SWs + zero new build-system risk aligns with the
   project's "simplicity first / no speculative deps" rules.
4. Serwist's advantage (first-visit-offline for *unvisited* routes) is not a stated field
   requirement; if measured to matter later, it's an additive change, not a rewrite.

If Hein wants true precache-everything offline-first now, we adopt Serwist for Layer B only
and keep Layer C hand-rolled either way.

---

## 6. Testing & Verification

- **Layer C (unit):** port and extend the existing `sync.test.ts` / `submitClockEvent.test.ts`
  patterns — enqueue, queue-full, flush success, transient-keep + early-exit, permanent-drain,
  attempts-cap abandon, dropped-record acknowledge. `fake-indexeddb` as in attendance tests.
- **Layer B (integration):** SW registers; offline navigation serves `/offline.html`; a
  visited route renders from cache offline; `/my`, `/stock`, fleet routes are **not**
  intercepted by `sw-app.js` (scope-arbitration regression test).
- **Layer A:** manifest validates (Lighthouse PWA installability check); icons present at
  192/512; `beforeinstallprompt` path exercised.
- **Pilot (e2e):** Playwright/Claude-in-Chrome — go offline, submit, see pending count, go
  online, see it sync; force a permanent error, see it land in "dropped".
- **Gate:** `npm run ci:quick` green; Lighthouse PWA "installable" pass; manual offline
  smoke on a real mobile viewport.

---

## 7. Open Questions for Review

1. **Pilot workflow** — Snags (recommended, §3.4) vs the original Works QA pick vs
   Activations/DR. Confirms which consumer Phase 0 wires up.
2. **Approach** — hand-rolled `sw-app.js` (recommended, §5) vs Serwist/next-pwa for Layer B.
3. **GET API read-cache allowlist** — which (if any) GET endpoints should render offline in
   Phase 0? Safe default: none beyond the shell; grow deliberately per workflow.
4. **Install affordance** — custom `InstallPrompt` UI (recommended) vs rely solely on the
   browser's native install button.

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| Root SW at `/` breaks `/my`/stock/fleet PWAs | Scope arbitration early-return + explicit regression test (§6) |
| Runtime-caching a per-user/auth GET cross-serves data | GET allowlist is opt-in only; never blanket `/api/*`; no caching of auth/session beyond the existing `/my` pattern |
| IndexedDB quota with photo payloads | Queue-depth cap + per-workflow quota validation; base64 for Phase 0, revisit for Activations |
| Silent SW update leaves stale app | Explicit update prompt via `VersionChecker` + versioned cache cleanup on activate |
| Two installable manifests (`/` and `/my`) confuse users | Distinct names ("FibreFlow" vs "VF Staff"); documented; `/my` scope unchanged |

---

## 9. File-Level Change Map (Phase 0)

**New:**
- `public/sw-app.js` — root service worker
- `public/icons/icon-192.png`, `icon-512.png`, `icon-192-maskable.png`, `icon-512-maskable.png`
- `src/lib/offline-queue/store.ts` — generic IndexedDB store (port of `db.ts`)
- `src/lib/offline-queue/flush.ts` — pure flush engine (port of `sync.ts`)
- `src/lib/offline-queue/useOfflineQueue.ts` — React hook
- `src/lib/offline-queue/types.ts`
- `src/lib/offline-queue/__tests__/*`
- `src/components/pwa/InstallPrompt.tsx`
- `src/hooks/useAppServiceWorker.ts` — root SW registration (port of `useServiceWorker.ts`)
- pilot consumer files (module TBD per §7.1)

**Modified:**
- `public/manifest.json` — proper icons/metadata
- `pages/_document.tsx` — add `<link rel="manifest">` + PWA meta
- `pages/_app.tsx` — register root SW, render `InstallPrompt`

**Untouched (guaranteed):** `sw-my.js`, `sw-stock.js`, `sw-fleet.js`, `manifest-my.json`,
and all three existing offline modules.

---

## 10. Definition of Done (Phase 0)

- [ ] Main app installs to home screen on Android + iOS Safari with a proper icon.
- [ ] Offline navigation shows a branded offline page; a visited route renders from cache.
- [ ] `/my`, field-stock, fleet PWAs verified unchanged (regression test green).
- [ ] `src/lib/offline-queue/` shipped with tests covering enqueue/flush/drain/abandon.
- [ ] Pilot workflow captures offline and syncs on reconnect; dropped items are visible.
- [ ] New-version reload prompt works.
- [ ] `npm run ci:quick` green; Lighthouse PWA installable pass.
