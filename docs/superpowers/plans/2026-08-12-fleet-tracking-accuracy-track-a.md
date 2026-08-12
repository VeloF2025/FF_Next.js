# Fleet Tracking Accuracy (Track A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut sampling lag for the 11 portal-tracked vehicles from up to 2 hours to minutes, detect trackers that have genuinely gone dark, and stop the map calling an idling vehicle "Moving" — without tripping the partner portals we do not own.

**Architecture:** Poll cadence moves from a cron literal into a per-account column on `fleet_tracking_watermarks`, so each portal ramps independently. Every alert threshold coupled to the old 2-hour tick rate converts to wall-clock first, because tightening the interval without that turns one reminder a day into one every two hours. Session eviction is split out of the credentials-failure path so normal human portal use stops paging. Per-vehicle silence is detected by anchoring on check-in events rather than fix counts.

**Tech Stack:** Next.js 14.2 (Pages Router), TypeScript, PostgreSQL via `pg.Pool` (`@/lib/db-pool`), Vitest, Leaflet/react-leaflet.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-12-fleet-tracking-accuracy-design.md` (commits `c73caffd7`, `52dc5cd87`).
- **Never read source from the main working tree.** It was 133 commits behind `origin/master` while this spec was drafted, which caused an entire design section to propose already-shipped work. Read from this worktree or `git show origin/master:<path>`.
- **All work happens in a git worktree**, never `/home/hein/Workspace/FF_Next.js` directly. A `PreToolUse` hook blocks writes there, and it inspects the shell's persistent cwd — so use `git -C <worktree>` rather than `cd` inside a compound command.
- **Every change goes through a PR.** Never commit to `master`.
- **The dev deploy applies migrations to the SHARED production database.** There is one database for dev and production. A migration is live for everyone the moment it runs.
- **No `console.log`** — use `log` from `@/lib/logger`. No empty catch blocks. Changed code is fully typed.
- **DGTS:** every test must be observed FAILING before its implementation exists. A test that passes against unmodified code proves nothing.
- Run `npm run ci:quick` before any PR. Tests are Vitest: `npx vitest run <path>`.
- **Exception monitoring is out of scope.** The data does not exist for portal vehicles at any cadence. Do not add features that imply otherwise.

---

### Task 1: Migration — cadence and gap-alert state

**Files:**
- Create: `scripts/migrations/sql/491_fleet_tracking_cadence.sql`
- Create: `scripts/migrations/sql/rollback_491_fleet_tracking_cadence.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `fleet_tracking_watermarks.poll_interval_minutes INTEGER NOT NULL DEFAULT 120` and `fleet_tracking_watermarks.last_gap_alert_at TIMESTAMPTZ NULL`. Tasks 2, 4, 5 and 6 all read these.

- [ ] **Step 1: Pre-flight — confirm the live table shape**

**RESOLVED before execution — do not re-investigate.** The apparent gap (`migrations.version` maxing at 416 while files run to 490) is a red herring. `scripts/run-pending-migrations.sh` tracks applied migrations in **`schema_migrations`, keyed by FILENAME**. That table contains `490_wiekus_health_safety_edit.sql`; nothing is missing. The `migrations` table is a legacy tracker that only receives a row when a migration file itself contains `INSERT INTO migrations (version, name, …)`, and 416 was simply the last file that did.

**Therefore 491 is the correct next number, and migration 491 MUST NOT contain `INSERT INTO migrations`.** The runner's own comment records why: a file that self-records in the legacy table but never lands in `schema_migrations` is seen as pending on the next run, re-executed, and aborts the deploy when its non-idempotent INSERT collides on `migrations_version_key`.

Confirm the live table shape rather than trusting this document:

```bash
PGPASSWORD="$PGPASSWORD" psql -h 100.96.203.105 -p 5437 -U fibreflow_user -d fibreflow \
  -c "\d fleet_tracking_watermarks"
```

Expected today: columns `provider`, `account_ref`, `last_event_ts`, `last_run_at`, `last_error`, `consecutive_failures`; PK `(provider, account_ref)`. If `poll_interval_minutes` already exists, STOP — someone has been here already.

- [ ] **Step 2: Write the migration**

```sql
-- 491: per-account poll cadence and gap-alert bookkeeping for fleet tracking.
--
-- The portal poll cadence lived only in a crontab (`0 */2 * * *`), which made
-- it impossible to ramp one partner without ramping all of them, and invisible
-- to the code that has to reason about it. staleness.ts hardcoded a matching
-- 3-hour threshold under the stated assumption "the cadence is set by cron" —
-- the two were coupled by comment, not by data.
--
-- DEFAULT 120 reproduces today's behaviour exactly, so this migration is inert
-- until a row is deliberately updated. That matters: this database is shared by
-- dev and production, so a migration that changed behaviour on apply would
-- change it for production the moment dev deployed.
--
-- last_gap_alert_at exists because the gap re-alert interval was counted in
-- TICKS (GAP_REPEAT_TICKS = 12, "roughly one reminder a day" at 2-hourly). Tick
-- counting silently tightens as the cadence tightens; at 10 minutes the same
-- constant means one reminder every two hours. Wall-clock needs a timestamp to
-- measure from, and there was nowhere to put one.

ALTER TABLE fleet_tracking_watermarks
  ADD COLUMN IF NOT EXISTS poll_interval_minutes INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS last_gap_alert_at TIMESTAMPTZ NULL;

ALTER TABLE fleet_tracking_watermarks
  ADD CONSTRAINT fleet_tracking_watermarks_poll_interval_check
  CHECK (poll_interval_minutes BETWEEN 1 AND 1440);
```

- [ ] **Step 3: Write the rollback**

```sql
-- Rollback 491.
ALTER TABLE fleet_tracking_watermarks
  DROP CONSTRAINT IF EXISTS fleet_tracking_watermarks_poll_interval_check;

ALTER TABLE fleet_tracking_watermarks
  DROP COLUMN IF EXISTS poll_interval_minutes,
  DROP COLUMN IF EXISTS last_gap_alert_at;
```

- [ ] **Step 4: Verify the rollback filename does not collide**

Seven version numbers already have colliding `rollback_` files in this repo, and `findRollbackFile` throws on ambiguity.

```bash
ls scripts/migrations/sql/ | grep -E "^(rollback_)?491"
```
Expected: exactly the two files created above.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/sql/491_fleet_tracking_cadence.sql \
        scripts/migrations/sql/rollback_491_fleet_tracking_cadence.sql
git commit -m "feat(fleet): add poll cadence and gap-alert columns to tracking watermarks"
```

---

### Task 2: Wall-clock gap re-alert

This must land before any cadence tightening. It is the landmine the spec opens with.

**Files:**
- Modify: `src/services/tracking/alerts.ts`
- Modify: `src/services/tracking/pollProvider.ts` (pass the new field, stamp the timestamp)
- Test: `src/services/tracking/__tests__/alerts.test.ts`

**Interfaces:**
- Consumes: `fleet_tracking_watermarks.last_gap_alert_at` from Task 1.
- Produces: `AlertInput.lastGapAlertAt: Date | null`; `AlertDecision.stampGapAlert: boolean`. Task 5 constructs `AlertInput` values and must set both.

- [ ] **Step 1: Write the failing tests**

Add to `src/services/tracking/__tests__/alerts.test.ts`:

```ts
describe('gap re-alert is wall-clock, not tick-counted', () => {
  const base = new Date('2026-08-12T09:00:00Z');

  it('alerts on the first gap regardless of elapsed time', () => {
    const d = decideAlert({
      kind: 'gap', consecutiveFailures: 1, nowSast: base, lastGapAlertAt: null,
    });
    expect(d?.event).toBe('fleet.tracking_data_gap');
    expect(d?.stampGapAlert).toBe(true);
  });

  it('stays silent 23 hours after the last gap alert', () => {
    const d = decideAlert({
      kind: 'gap', consecutiveFailures: 50, nowSast: base,
      lastGapAlertAt: new Date(base.getTime() - 23 * 3600_000),
    });
    expect(d).toBeNull();
  });

  it('re-alerts once 24 hours have passed', () => {
    const d = decideAlert({
      kind: 'gap', consecutiveFailures: 50, nowSast: base,
      lastGapAlertAt: new Date(base.getTime() - 24 * 3600_000 - 1000),
    });
    expect(d?.event).toBe('fleet.tracking_data_gap');
  });

  it('does not tighten when the poll interval tightens', () => {
    // The whole point: at a 10-minute cadence a vehicle accumulates 144 gap
    // ticks a day. Under tick counting that alerted 12 times; it must not.
    const d = decideAlert({
      kind: 'gap', consecutiveFailures: 144, nowSast: base,
      lastGapAlertAt: new Date(base.getTime() - 3600_000),
    });
    expect(d).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/tracking/__tests__/alerts.test.ts -t 'wall-clock'`
Expected: FAIL — `lastGapAlertAt` is not a property of `AlertInput`, and `stampGapAlert` is undefined.

- [ ] **Step 3: Implement**

In `src/services/tracking/alerts.ts`, replace `GAP_REPEAT_TICKS` and the gap branch:

```ts
/**
 * A sustained gap re-alerts at most once a day.
 *
 * This was GAP_REPEAT_TICKS = 12, counted in ticks and calibrated to a 2-hourly
 * job. Tick counting silently tightens as the cadence tightens: at a 10-minute
 * interval the same 12 ticks is one reminder every two hours, which the original
 * comment already identified as the failure mode — "the recipient learns to
 * ignore the channel". Wall-clock holds the promise the constant was making.
 */
const GAP_REPEAT_AFTER_MS = 24 * 3600_000;
```

Extend `AlertInput`:

```ts
  /**
   * When this provider/account last had a gap alert raised, or null if never.
   * Read from fleet_tracking_watermarks.last_gap_alert_at. Null means "first
   * gap" and always alerts — failing loud on the first occurrence is the point.
   */
  lastGapAlertAt: Date | null;
```

Extend `AlertDecision`:

```ts
export interface AlertDecision {
  event: 'fleet.tracking_pull_failed' | 'fleet.tracking_data_gap' | 'fleet.tracking_pull_degraded';
  /**
   * Whether the caller must write `now` to last_gap_alert_at. Only gap
   * decisions set this — the auth and transient paths have their own
   * bookkeeping in consecutive_failures and must not disturb the gap clock.
   */
  stampGapAlert?: boolean;
}
```

Replace the gap branch:

```ts
  if (input.kind === 'gap') {
    const last = input.lastGapAlertAt;
    const due = last === null || input.nowSast.getTime() - last.getTime() >= GAP_REPEAT_AFTER_MS;
    if (!due) return null;
    return { event: 'fleet.tracking_data_gap', stampGapAlert: true };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/tracking/__tests__/alerts.test.ts`
Expected: PASS, including every pre-existing test in that file. The auth and transient branches are untouched and their tests must stay green.

- [ ] **Step 5: Wire the caller**

In `src/services/tracking/pollProvider.ts`, extend the watermark read at lines 75–84:

```ts
    const wm = await sql<{
      last_event_ts: Date | null;
      consecutive_failures: number;
      last_error: string | null;
      last_run_at: Date | null;
      last_gap_alert_at: Date | null;
    }>`
      SELECT last_event_ts, consecutive_failures, last_error, last_run_at, last_gap_alert_at
      FROM fleet_tracking_watermarks
      WHERE provider = ${provider.key} AND account_ref = ${provider.accountRef}
    `;
```

Capture it beside `priorError`:

```ts
    const lastGapAlertAt = wm[0]?.last_gap_alert_at ? new Date(wm[0].last_gap_alert_at) : null;
```

Pass `lastGapAlertAt` on every `AlertInput` this function builds — the gap path uses it, and the auth/transient/evicted paths must still supply it because it is a required field.

For the stamp, the gap branch at lines 170–179 already does `INSERT … ON CONFLICT DO UPDATE`. **Do not add a conditional SQL fragment**: the comment directly above it records that this repo's SQL tag cannot carry `${cond ? sql`..` : sql``}`. Write the stamp as a separate statement after the alert decision instead:

```ts
    if (decision?.stampGapAlert) {
      await sql`
        UPDATE fleet_tracking_watermarks SET last_gap_alert_at = now()
        WHERE provider = ${provider.key} AND account_ref = ${provider.accountRef}
      `;
    }
```

- [ ] **Step 6: Run the full tracking suite**

Run: `npx vitest run src/services/tracking`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/tracking/alerts.ts src/services/tracking/pollProvider.ts \
        src/services/tracking/__tests__/alerts.test.ts
git commit -m "fix(fleet): make gap re-alert wall-clock so cadence changes cannot multiply alerts"
```

---

### Task 3: Eviction is not a credentials failure

**Files:**
- Modify: `src/services/tracking/authFailure.ts`
- Modify: `src/services/tracking/alerts.ts`
- Test: `src/services/tracking/__tests__/isAuthFailure.test.ts`, `src/services/tracking/__tests__/alerts.test.ts`

**Interfaces:**
- Consumes: `AlertInput` from Task 2.
- Produces: `isEviction(message: string): boolean`; `AlertKind` gains `'evicted'`; `AlertInput.evictedSinceMs: number | null`.

- [ ] **Step 1: Write the failing tests**

In `src/services/tracking/__tests__/isAuthFailure.test.ts`:

```ts
describe('eviction is distinguished from bad credentials', () => {
  it('classifies a lost session as eviction, not auth', () => {
    const msg = '[portal-session] still logged out after re-auth: /Main/VehicleRepo/GetVehicleTreeDataPaging';
    expect(isEviction(msg)).toBe(true);
    expect(isAuthFailure(msg)).toBe(false);
  });

  it('still treats a rejected login as auth', () => {
    expect(isAuthFailure('login failed')).toBe(true);
    expect(isEviction('login failed')).toBe(false);
  });

  it('still treats 401/403 as auth', () => {
    expect(isAuthFailure('HTTP 401 Unauthorized')).toBe(true);
    expect(isAuthFailure('HTTP 403 Forbidden')).toBe(true);
  });

  it('keeps the other providers auth vocabulary intact', () => {
    for (const m of [
      'still rejected after re-mint',
      'login did not yield a session',
      'bot challenge did not clear',
      'still unauthenticated after re-login',
      'issued no session cookies',
    ]) {
      expect(isAuthFailure(m)).toBe(true);
    }
  });
});
```

In `src/services/tracking/__tests__/alerts.test.ts`:

```ts
describe('evicted kind', () => {
  const noon = new Date('2026-08-12T10:00:00Z'); // 12:00 SAST, working hours

  it('does not alert on a fresh eviction — a human using their portal is not an incident', () => {
    expect(decideAlert({
      kind: 'evicted', consecutiveFailures: 1, nowSast: noon,
      lastGapAlertAt: null, evictedSinceMs: 5 * 60_000,
    })).toBeNull();
  });

  it('escalates to auth-grade once eviction is sustained past 30 minutes', () => {
    // A dead password can present identically, so it must not hide here forever.
    expect(decideAlert({
      kind: 'evicted', consecutiveFailures: 4, nowSast: noon,
      lastGapAlertAt: null, evictedSinceMs: 31 * 60_000,
    })?.event).toBe('fleet.tracking_pull_failed');
  });

  it('sustained eviction overnight uses the no-WhatsApp event', () => {
    const night = new Date('2026-08-12T20:00:00Z'); // 22:00 SAST
    expect(decideAlert({
      kind: 'evicted', consecutiveFailures: 4, nowSast: night,
      lastGapAlertAt: null, evictedSinceMs: 31 * 60_000,
    })?.event).toBe('fleet.tracking_pull_degraded');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/tracking/__tests__/isAuthFailure.test.ts src/services/tracking/__tests__/alerts.test.ts`
Expected: FAIL — `isEviction` is not exported; `'evicted'` is not an `AlertKind`.

- [ ] **Step 3: Implement in `authFailure.ts`**

Remove `'still logged out'` from the `isAuthFailure` pattern list and add:

```ts
/**
 * Whether a failure is Netstar's single-session limit rather than bad credentials.
 *
 * PortalSession throws "still logged out after re-auth" when it logged in
 * successfully and was then evicted — which is what happens when a human opens
 * the same portal. That self-heals when they leave, so it must not page.
 *
 * It was previously matched by isAuthFailure's 'still logged out' entry and
 * therefore raised fleet.tracking_pull_failed, the WhatsApp-enabled event. At a
 * 2-hourly cadence that collided with a human 12 times a day at most. The
 * cadence ramp takes that to 144, so an operator working in the portal for an
 * hour would have paged roughly six times for a healthy system.
 *
 * A dead password can produce the same message, so callers must escalate this
 * when it persists — see EVICTION_ESCALATE_AFTER_MS in alerts.ts.
 */
export function isEviction(message: string): boolean {
  return /still logged out/i.test(message);
}
```

- [ ] **Step 4: Implement in `alerts.ts`**

```ts
export type AlertKind = 'auth' | 'transient' | 'gap' | 'evicted';
```

Add to `AlertInput`:

```ts
  /**
   * How long this account has been continuously evicted, in ms; null or absent
   * when the failure is not an eviction. Below the escalation threshold this
   * stays silent on purpose.
   *
   * OPTIONAL deliberately: every non-evicted call site would otherwise have to
   * pass a meaningless null, and the tests written in Task 2 would stop
   * compiling the moment this field landed.
   */
  evictedSinceMs?: number | null;
```

```ts
/**
 * Eviction is only newsworthy once it stops looking like a human at a keyboard.
 * Thirty minutes is longer than a portal session someone opens to check one
 * vehicle, and short enough that a genuinely dead password is not hidden for a
 * working day.
 */
const EVICTION_ESCALATE_AFTER_MS = 30 * 60_000;
```

Insert before the auth branch:

```ts
  if (input.kind === 'evicted') {
    const sustained =
      input.evictedSinceMs !== null && input.evictedSinceMs >= EVICTION_ESCALATE_AFTER_MS;
    if (!sustained) return null;
    // Sustained eviction is indistinguishable from a dead credential, so from
    // here it takes the auth path's working-hours channel policy exactly.
  }
```

Then let it fall through to the existing working-hours logic at the bottom of the function, which already returns `fleet.tracking_pull_failed` during working hours and `fleet.tracking_pull_degraded` outside them. Do not duplicate that logic.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/services/tracking`
Expected: PASS. Pay attention to `isSameFailureKind`, which is defined as `isAuthFailure(a) === isAuthFailure(b)` — moving eviction out of `isAuthFailure` changes which failures count as one streak. If any existing test asserts an eviction message shares a streak with an auth message, that assertion now encodes the bug and must be updated with a comment saying so.

- [ ] **Step 6: Commit**

```bash
git add src/services/tracking/authFailure.ts src/services/tracking/alerts.ts \
        src/services/tracking/__tests__/isAuthFailure.test.ts \
        src/services/tracking/__tests__/alerts.test.ts
git commit -m "fix(fleet): stop paging when a human takes the Netstar session"
```

---

### Task 4: Cadence gate

**Files:**
- Create: `src/services/tracking/cadence.ts`
- Create: `src/services/tracking/__tests__/cadence.test.ts`
- Modify: `pages/api/cron/poll-portal-tracking.ts`

**Interfaces:**
- Consumes: `poll_interval_minutes` from Task 1.
- Produces: `isTickDue(lastRunAt: Date | null, intervalMinutes: number, now: Date): boolean`; `nextInterval(current, direction)` is Task 5's, not this one's.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { isTickDue } from '../cadence';

describe('isTickDue', () => {
  const now = new Date('2026-08-12T10:00:00Z');

  it('runs when the account has never run', () => {
    expect(isTickDue(null, 120, now)).toBe(true);
  });

  it('skips when the interval has not elapsed', () => {
    expect(isTickDue(new Date(now.getTime() - 60 * 60_000), 120, now)).toBe(false);
  });

  it('runs once the interval has elapsed', () => {
    expect(isTickDue(new Date(now.getTime() - 120 * 60_000), 120, now)).toBe(true);
  });

  it('runs slightly early rather than skipping a whole cycle', () => {
    // Cron fires on the minute and last_run_at is stamped seconds later, so an
    // exact >= comparison drops every other tick. 30s of grace absorbs that.
    expect(isTickDue(new Date(now.getTime() - 119.7 * 60_000), 120, now)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/tracking/__tests__/cadence.test.ts`
Expected: FAIL — cannot resolve `../cadence`.

- [ ] **Step 3: Implement `src/services/tracking/cadence.ts`**

```ts
/**
 * Whether a provider/account is due for a poll.
 *
 * The cron fires at the fastest supported rate and each account decides for
 * itself, so one portal can be ramped without touching the others and without a
 * deploy. The alternative — one cron entry per account — puts the cadence back
 * in a crontab where the code cannot see it.
 */

/**
 * Cron fires on the minute; last_run_at is stamped a few seconds later, so the
 * measured gap is reliably a hair under the interval. Without grace, a 120-minute
 * interval polled by a 120-minute cron skips every other tick.
 */
const DUE_GRACE_MS = 30_000;

export function isTickDue(
  lastRunAt: Date | null,
  intervalMinutes: number,
  now: Date
): boolean {
  if (lastRunAt === null) return true;
  return now.getTime() - lastRunAt.getTime() >= intervalMinutes * 60_000 - DUE_GRACE_MS;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/services/tracking/__tests__/cadence.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `pollProvider`, not the handler**

The gate belongs beside the existing watermark read in `pollProvider.ts`, not in the cron handler — that read already happens first, before anything authenticates, and the breaker's early-return pattern is right there to copy. Putting it in the handler would mean a second query for state `pollProvider` is about to fetch anyway.

Extend the SELECT (already being extended by Task 2) to add `poll_interval_minutes`, then gate immediately after the breaker check:

```ts
    // Not due yet: the cron fires at the fastest supported rate and each account
    // decides for itself, so one portal can be ramped without touching others.
    // Like the breaker's throttled path, this writes NOTHING — last_run_at must
    // keep meaning "when we last actually polled".
    if (!isTickDue(
      wm[0]?.last_run_at ? new Date(wm[0].last_run_at) : null,
      wm[0]?.poll_interval_minutes ?? 120,
      new Date()
    )) {
      return { provider: provider.key, accountRef: provider.accountRef, skipped: 'not-due' };
    }
```

Leave the advisory lock in the handler exactly as it is — it guards overlapping runs and is independent of cadence.

- [ ] **Step 6: Change the cron to the fastest supported rate**

Not applied yet — this is a deploy step, recorded here so it is not forgotten. The crontab entry becomes `*/10 * * * *`. Every account still has `poll_interval_minutes = 120`, so behaviour is unchanged until a row is deliberately updated. Verify after deploying that the log shows `not-due` skips, not extra polls.

- [ ] **Step 7: Commit**

```bash
git add src/services/tracking/cadence.ts \
        src/services/tracking/__tests__/cadence.test.ts \
        pages/api/cron/poll-portal-tracking.ts
git commit -m "feat(fleet): per-account poll cadence gate"
```

---

### Task 5: Automatic demotion

**Files:**
- Modify: `src/services/tracking/cadence.ts`
- Modify: `src/services/tracking/pollProvider.ts`
- Test: `src/services/tracking/__tests__/cadence.test.ts`

**Interfaces:**
- Consumes: `isTickDue` (Task 4), `isEviction` (Task 3).
- Produces: `RAMP_STEPS: readonly number[]`, `demote(current: number): number`.

- [ ] **Step 1: Write the failing test**

```ts
import { RAMP_STEPS, demote } from '../cadence';

describe('demotion', () => {
  it('steps back to the next slower interval', () => {
    expect(demote(10)).toBe(30);
    expect(demote(30)).toBe(120);
  });

  it('stops at the slowest step', () => {
    expect(demote(120)).toBe(120);
  });

  it('snaps an unrecognised interval to the slowest step', () => {
    // A hand-edited row must fail safe — slower, never faster.
    expect(demote(7)).toBe(120);
  });

  it('never proposes a step outside the ramp', () => {
    for (const s of RAMP_STEPS) expect(RAMP_STEPS).toContain(demote(s));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/tracking/__tests__/cadence.test.ts -t demotion`
Expected: FAIL — `RAMP_STEPS` and `demote` are not exported.

- [ ] **Step 3: Implement**

```ts
/**
 * Allowed poll intervals, fastest first.
 *
 * Promotion is deliberately NOT automated. We are polling partner portals we do
 * not own, without their permission, so the only movement the system makes on
 * its own should be backwards. Tightening is a human running one UPDATE.
 */
export const RAMP_STEPS = [10, 30, 120] as const;

/** The next slower interval. Unrecognised values snap to the slowest. */
export function demote(current: number): number {
  const i = RAMP_STEPS.indexOf(current as (typeof RAMP_STEPS)[number]);
  if (i === -1) return RAMP_STEPS[RAMP_STEPS.length - 1];
  return RAMP_STEPS[Math.min(i + 1, RAMP_STEPS.length - 1)];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/services/tracking/__tests__/cadence.test.ts`
Expected: PASS.

- [ ] **Step 5: Apply demotion in `pollProvider.ts`**

**First, read `authBreakerDecision` and understand it.** `pollProvider` already has a circuit breaker with `open` / `half-open` / `hard-stop` states that skips ticks entirely on repeated auth failure, and its comment (lines 87–91) explains that a skipped tick deliberately does **not** write the watermark, so that `consecutive_failures` can still be cleared by a probe. Demotion must not fight this:

- Never demote from inside the throttled path (`decision.state === 'open' | 'hard-stop'`). That path returns early via `reportThrottled` and writes nothing by design — adding a write there would freeze the counter the breaker relies on.
- Demote only on a tick that actually ran and failed.

`currentIntervalMinutes` comes from the watermark read, which Task 4 already extended to select `poll_interval_minutes`:

```ts
    const currentIntervalMinutes = wm[0]?.poll_interval_minutes ?? 120;
```

Add the demotion as a separate statement, for the same reason as Task 2 — no conditional SQL fragments:

```ts
    // Slow down rather than keep hammering a portal that is pushing back.
    // Deliberately NOT inside the breaker's throttled path: that path writes no
    // watermark on purpose, so that a probe can still clear consecutive_failures.
    const slower = demote(currentIntervalMinutes);
    if (slower !== currentIntervalMinutes) {
      await sql`
        UPDATE fleet_tracking_watermarks SET poll_interval_minutes = ${slower}
        WHERE provider = ${provider.key} AND account_ref = ${provider.accountRef}
      `;
      log.warn('[poll-portal-tracking] cadence demoted after portal pushback', {
        provider: provider.key, accountRef: provider.accountRef,
        from: currentIntervalMinutes, to: slower,
      });
    }
```

Do not demote on a transient network blip. Those are already absorbed by `TRANSIENT_THRESHOLD`, and demoting on them would ratchet every account back to 120 within a day of ordinary internet weather.

- [ ] **Step 6: Run the full tracking suite**

Run: `npx vitest run src/services/tracking`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/tracking/cadence.ts src/services/tracking/pollProvider.ts \
        src/services/tracking/__tests__/cadence.test.ts
git commit -m "feat(fleet): back off poll cadence automatically when a portal pushes back"
```

---

### Task 6: Staleness derives from configured cadence

**Files:**
- Modify: `src/services/tracking/staleness.ts`
- Modify: `pages/api/fleet/positions/live.ts`
- Test: `src/services/tracking/__tests__/staleness.test.ts`

**Interfaces:**
- Consumes: `poll_interval_minutes` (Task 1).
- Produces: `staleAfterSecondsFor(provider, accountRef, intervalMinutes, env?)`. The third parameter is new and required.

- [ ] **Step 1: Write the failing test**

```ts
import { staleAfterSecondsFor, DEFAULT_STALE_AFTER_SECONDS } from '../staleness';

describe('staleAfterSecondsFor derives from configured cadence', () => {
  it('is twice the configured interval — one missed tick is tolerated', () => {
    expect(staleAfterSecondsFor('netstar', 'europcar', 120)).toBe(2 * 120 * 60);
    expect(staleAfterSecondsFor('netstar', 'europcar', 10)).toBe(2 * 10 * 60);
  });

  it('falls back leniently when no interval is configured', () => {
    // A false "stale" is the failure this module exists to remove.
    expect(staleAfterSecondsFor('netstar', 'europcar', null))
      .toBe(DEFAULT_STALE_AFTER_SECONDS);
  });

  it('still keys on ACCOUNT, because Cartrack runs a fast and a slow feed', () => {
    const portal = staleAfterSecondsFor('cartrack', 'urent', 120);
    const rest = staleAfterSecondsFor('cartrack', 'velocity', 2);
    expect(portal).toBeGreaterThan(rest);
  });

  it('treats an unrecognised Cartrack account as the FAST feed', () => {
    // Documented inversion: the portal account name is the reliable one.
    expect(staleAfterSecondsFor('cartrack', 'something-new', 2)).toBe(2 * 2 * 60);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/tracking/__tests__/staleness.test.ts`
Expected: FAIL — the function takes two arguments and ignores any interval.

- [ ] **Step 3: Implement**

Keep the existing module header and both of its warnings — the account-vs-provider reasoning and the unrecognised-Cartrack-account inversion still apply. Amend the sentence "The cadence is set by cron" to name `fleet_tracking_watermarks.poll_interval_minutes`, because that assumption is precisely what made the constant wrong.

```ts
/** One missed tick is tolerated; two means we genuinely have not heard. */
const MISSED_TICKS_TOLERATED = 2;

export function staleAfterSecondsFor(
  provider: string | null,
  accountRef: string | null,
  intervalMinutes: number | null,
  env: NodeJS.ProcessEnv = process.env
): number {
  if (!provider || !accountRef) return DEFAULT_STALE_AFTER_SECONDS;

  // No configured cadence: fall back leniently. A false "stale" is the failure
  // this module exists to remove; a late flag merely delays a rare one.
  if (intervalMinutes === null) return DEFAULT_STALE_AFTER_SECONDS;

  // Cartrack runs a fast REST feed and a slow portal feed at once, so the
  // account decides, not the provider name. Retained from the original — see
  // the header for why the test runs "is it the PORTAL" rather than "is it the
  // fast one".
  void cartrackPortalAccount(env);

  return intervalMinutes * MISSED_TICKS_TOLERATED * 60;
}
```

Note the account-keyed branch collapses once cadence is data: both Cartrack accounts now get the right threshold from their own configured interval, which is what the special case was approximating. **Keep `cartrackPortalAccount` and its test** — deleting it would silently remove the guard the header warns about for any future second Cartrack account. If the reviewer disagrees and wants it gone, that is a deliberate decision to record, not a cleanup.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/services/tracking/__tests__/staleness.test.ts`
Expected: PASS.

- [ ] **Step 5: Supply the interval in `live.ts`**

The query already selects `p.provider` and `p.account_ref` from the lateral join. Add a `LEFT JOIN fleet_tracking_watermarks w ON w.provider = p.provider AND w.account_ref = p.account_ref` and select `w.poll_interval_minutes`, passing it as the third argument. A vehicle with no matching watermark row yields null and takes the lenient fallback, which is the correct behaviour for a vehicle whose feed we know nothing about.

- [ ] **Step 6: Verify against real data**

```bash
PGPASSWORD="$PGPASSWORD" psql -h 100.96.203.105 -p 5437 -U fibreflow_user -d fibreflow -c "
SELECT v.registration, p.provider, p.account_ref, w.poll_interval_minutes
FROM fleet_vehicles v
JOIN fleet_vehicle_trackers t ON t.vehicle_id=v.id AND t.is_active
LEFT JOIN LATERAL (SELECT provider, account_ref FROM fleet_vehicle_positions
                   WHERE vehicle_id=v.id ORDER BY recorded_at DESC LIMIT 1) p ON true
LEFT JOIN fleet_tracking_watermarks w ON w.provider=p.provider AND w.account_ref=p.account_ref
WHERE v.status='active' ORDER BY 2,3;"
```
Expected: every tracked vehicle resolves to a watermark row with an interval. Any NULL is a vehicle that will silently take the lenient fallback — investigate before shipping.

- [ ] **Step 7: Commit**

```bash
git add src/services/tracking/staleness.ts pages/api/fleet/positions/live.ts \
        src/services/tracking/__tests__/staleness.test.ts
git commit -m "fix(fleet): derive staleness from configured cadence, not a constant"
```

---

### Task 7: `idling` status

This is the HW50KNGP bug: ignition on at 0 km/h renders "Moving".

**Files:**
- Modify: `src/modules/fleet/utils/liveMapHelpers.ts`
- Test: `src/modules/fleet/utils/__tests__/liveMapHelpers.test.ts`

**Interfaces:**
- Consumes: `LiveVehicle` from `live.ts`.
- Produces: `VehicleStatus` gains `'idling'`; `STATUS_STYLE` gains a matching entry.

- [ ] **Step 1: Write the failing test**

```ts
const v = (over: Partial<LiveVehicle>): LiveVehicle => ({
  vehicleId: 'x', registration: 'HW50KNGP', driverName: null, provider: 'cartrack',
  lat: -25.71, lon: 28.21, speedKph: 0, ignition: true, isSpeeding: false,
  recordedAt: new Date().toISOString(), ageSeconds: 3600, isStale: false,
  staleAfterSeconds: 10800, trackingState: 'tracked', ...over,
});

describe('idling', () => {
  it('reports idling for a fresh fix with the engine on and no speed', () => {
    expect(statusFor(v({ ignition: true, speedKph: 0, isStale: false }))).toBe('idling');
  });

  it('still reports moving when there is speed', () => {
    expect(statusFor(v({ ignition: true, speedKph: 42, isStale: false }))).toBe('moving');
  });

  it('reports moving when speed is UNKNOWN — absence of data is not evidence of stillness', () => {
    expect(statusFor(v({ ignition: true, speedKph: null, isStale: false }))).toBe('moving');
  });

  it('still reports lostContact when the fix is stale, whatever the speed', () => {
    expect(statusFor(v({ ignition: true, speedKph: 0, isStale: true }))).toBe('lostContact');
  });

  it('has a style entry, so the legend cannot drift', () => {
    expect(STATUS_STYLE.idling).toBeDefined();
    expect(STATUS_STYLE.idling.label).toBe('Idling');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/fleet/utils/__tests__/liveMapHelpers.test.ts -t idling`
Expected: FAIL — `statusFor` returns `'moving'` for the first case.

- [ ] **Step 3: Implement**

Add `'idling'` to the `VehicleStatus` union. Replace line 76's branch:

```ts
  if (v.ignition === true) {
    if (v.isStale) return 'lostContact';
    // Only an explicit zero is evidence of not moving. A null speed means the
    // provider did not say, and inventing "idle" from silence would misreport
    // every feed that omits the field.
    return v.speedKph === 0 ? 'idling' : 'moving';
  }
```

Add to `STATUS_STYLE`:

```ts
  // Same green family as moving — the engine is running either way — but
  // lighter, because the vehicle is not going anywhere.
  idling: { fill: '#0f9d6b', fillOpacity: 0.55, label: 'Idling' },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/modules/fleet/utils`
Expected: PASS, including every pre-existing `statusFor` test.

- [ ] **Step 5: Typecheck — the union gained a member**

Run: `npx tsc --noEmit`
Expected: PASS. Any exhaustive `Record<VehicleStatus, …>` or switch that does not handle `idling` fails here. CI never runs `next build`, so this step is the only thing that catches it.

- [ ] **Step 6: Verify in a browser**

Code review is not verification for UI. Start the app, open `/fleet/map`, and confirm a vehicle with ignition on at 0 km/h shows "Idling" rather than "Moving · 0 km/h", and that the legend shows the new swatch.

```bash
PORT=3004 npm run dev
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/fleet/utils/liveMapHelpers.ts \
        src/modules/fleet/utils/__tests__/liveMapHelpers.test.ts
git commit -m "fix(fleet): an idling vehicle is not moving"
```

---

### Task 8: Per-vehicle silence detection

**Files:**
- Create: `src/services/tracking/silence.ts`
- Create: `src/services/tracking/__tests__/silence.test.ts`
- Modify: `pages/api/cron/poll-portal-tracking.ts`

**Interfaces:**
- Consumes: `raiseTrackingAlert` (Task 2/3).
- Produces: `findSilentTrackers(rows: CheckInAnchor[], windowMs: number): SilentTracker[]`.

- [ ] **Step 1: Calibrate the window against real data first**

The spec deliberately does not guess this number. Measure the alignment between check-ins and fixes before choosing it:

```bash
PGPASSWORD="$PGPASSWORD" psql -h 100.96.203.105 -p 5437 -U fibreflow_user -d fibreflow -c "
SELECT v.registration,
       c.created_at AT TIME ZONE 'Africa/Johannesburg' AS checkin_sast,
       min(abs(extract(epoch FROM (p.recorded_at - c.created_at))))/3600 AS nearest_fix_hours
FROM fleet_check_records c
JOIN fleet_vehicles v ON v.id = c.vehicle_id
JOIN fleet_vehicle_trackers t ON t.vehicle_id = v.id AND t.is_active
LEFT JOIN fleet_vehicle_positions p ON p.vehicle_id = v.id
WHERE c.created_at > now() - interval '30 days'
GROUP BY 1,2 ORDER BY 3 DESC NULLS FIRST LIMIT 40;"
```

Choose the window from the distribution's healthy bulk, and record the chosen value and its justification in a comment. If the data does not separate healthy from silent cleanly, STOP and report that — a detector that cannot discriminate is worse than none, and shipping it anyway is the failure mode this whole spec is about.

- [ ] **Step 2: Write the failing test**

```ts
import { findSilentTrackers } from '../silence';

const HOUR = 3600_000;
const checkin = new Date('2026-08-12T08:00:00Z');

describe('findSilentTrackers', () => {
  it('flags a vehicle checked in with no fix anywhere near it', () => {
    const out = findSilentTrackers(
      [{ vehicleId: 'a', registration: 'HW50KNGP', checkInAt: checkin, nearestFixMs: 40 * HOUR }],
      6 * HOUR
    );
    expect(out.map((s) => s.registration)).toEqual(['HW50KNGP']);
  });

  it('does not flag a vehicle whose tracker reported near the check-in', () => {
    expect(findSilentTrackers(
      [{ vehicleId: 'b', registration: 'LG94NLGP', checkInAt: checkin, nearestFixMs: 1 * HOUR }],
      6 * HOUR
    )).toEqual([]);
  });

  it('does not assess a vehicle with no fixes AND no check-in evidence', () => {
    // nearestFixMs null means we have no anchor. Silence must mean "not
    // assessed", never "healthy" and never "dead".
    expect(findSilentTrackers(
      [{ vehicleId: 'c', registration: 'CR69KTZN', checkInAt: checkin, nearestFixMs: null }],
      6 * HOUR
    )).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/services/tracking/__tests__/silence.test.ts`
Expected: FAIL — cannot resolve `../silence`.

- [ ] **Step 4: Implement**

```ts
/**
 * Trackers that have gone dark, detected by anchoring on check-ins.
 *
 * A check-in is independent evidence that a human was physically at the vehicle
 * at a known time. If the tracker said nothing anywhere near that moment, the
 * tracker is the thing at fault — not the vehicle being parked.
 *
 * Two detectors were rejected first, and both failed for reasons worth keeping:
 *
 *  - A fixed "no fix in N hours" threshold fires on every vehicle parked
 *    overnight. LL92LYGP legitimately goes 15 hours quiet.
 *  - Comparing fix COUNTS between vehicles measures how much each one drove.
 *    Over 7 days HW50KNGP logged 4 fixes to a sibling's 32 — but it also drove
 *    167km to that sibling's 926km. Normalised, it was within ~1.5x. The raw
 *    ratio looked like a smoking gun and was not one.
 *
 * Odometer readings are deliberately NOT an input: one vehicle reported a
 * 909,312 km delta in a single week, so magnitude cannot be trusted without
 * outlier rejection. Only the check-in's EXISTENCE and TIME are used.
 */
export interface CheckInAnchor {
  vehicleId: string;
  registration: string;
  checkInAt: Date;
  /** Distance in ms to the nearest fix, or null when there is no fix at all. */
  nearestFixMs: number | null;
}

export interface SilentTracker {
  vehicleId: string;
  registration: string;
  checkInAt: Date;
}

export function findSilentTrackers(
  rows: CheckInAnchor[],
  windowMs: number
): SilentTracker[] {
  return rows
    .filter((r) => r.nearestFixMs !== null && r.nearestFixMs > windowMs)
    .map(({ vehicleId, registration, checkInAt }) => ({ vehicleId, registration, checkInAt }));
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/services/tracking/__tests__/silence.test.ts`
Expected: PASS.

- [ ] **Step 6: Raise it as a gap-grade alert**

Call this once per portal poll tick, and route any results through `raiseTrackingAlert` with `kind: 'gap'`. Never WhatsApp: a dead tracker is a maintenance item, and Tasks 2 and 3 are already spending the alert budget on things that need a human tonight.

- [ ] **Step 7: Commit**

```bash
git add src/services/tracking/silence.ts \
        src/services/tracking/__tests__/silence.test.ts \
        pages/api/cron/poll-portal-tracking.ts
git commit -m "feat(fleet): detect trackers that have gone dark, anchored on check-ins"
```

---

## Rollout

The code is inert until a row is updated. Ramp one account at a time, slowest-risk first.

1. Merge Tasks 1–8. Every account still reads `poll_interval_minutes = 120`; nothing changes.
2. Change the cron to `*/10 * * * *`. Confirm the log shows `not-due` skips.
3. Promote **one** account to 30: `UPDATE fleet_tracking_watermarks SET poll_interval_minutes = 30 WHERE provider = 'netstar';`
4. Hold 24 hours. Check `consecutive_failures`, `last_error`, and the eviction rate.
5. Promote to 10 only if that window was clean. Then repeat for `ituran/avis`.
6. **`cartrack/urent` last, and watch it hardest** — its rejected-credential endpoint counts toward a lockout.

Demotion is automatic at every step. Promotion never is.

## Known gaps

- Nothing here proves the ramp is safe against the live portals; only the staged rollout does.
- Exception monitoring remains impossible for all 11 portal vehicles at any cadence. That is Track B, and Track B may conclude it cannot be done without a commercial change.
- The `migrations.version` / migration-file discrepancy (416 vs 490) is unexplained and is a pre-flight check in Task 1, not a resolved question.
- The odometer data-quality defect (909,312 km in a week) is real, out of scope here, and deserves its own ticket.
