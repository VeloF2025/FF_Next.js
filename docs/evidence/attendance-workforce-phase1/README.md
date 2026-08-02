# Attendance workforce Phase 1 browser evidence

These PNGs are the stable, committed copies from the controlled-browser run at the Task 14 fix head. They are not database, DEV, or production evidence.

Run command:

```bash
E2E_BASE_URL=http://127.0.0.1:3006 npm run test:e2e -- \
  tests/e2e/attendance-workforce-phase1.spec.ts \
  tests/e2e/attendance-workforce-actions.spec.ts \
  tests/e2e/attendance-workforce-clock.spec.ts
```

Result: 13/13 passed (one auth setup plus twelve Chromium journeys).

The controlled fixture intercepts only scoped APIs while pages and assets come from a real local Next.js process. Visual inspection found no horizontal clipping; both 390 px mobile confirmations retain clear hierarchy and touch targets. Desktop empty, error, unavailable, unreliable, stale, readiness, and report states remain distinct and legible. Long action/readiness detail uses ordinary vertical scrolling at 720 px.

`attendance-offline-open-entry-conflict.png` was captured after controlled sync and readback. A real IndexedDB `PendingClockEvent` had drained into the durable dropped-events store after the actual `409 CONFLICT` `details.reason=open_entry` contract; the UI now reports that the queued event was not submitted instead of retaining stale queued copy. The server fixture retains exactly one open entry; this is not proof of persisted PostgreSQL state.
