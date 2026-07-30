# Task 8 — QField Project Statistics API Route

## Delivered

- Added `GET /api/qfield/project-stats` as a named handler plus the exact
  `withAuth(withPermission('projects', 'view')(...))` default export.
- Uses the real project-stats query parser and authenticated user ID/email.
- Adds `X-Request-Id` and response metadata, maps safe domain errors through
  the standard envelope, and returns a generic logged 500 for unexpected errors.
- Rejects non-GET requests with the standard 405 response.

## TDD evidence

- RED: `npx vitest run tests/api/qfield/project-stats.test.ts` failed because
  the route import did not exist.
- GREEN: the focused API suite passes 8/8 tests.
- Regression: the API, project-stats module, and real permission middleware
  suite pass 74/74 tests across 14 files.

## Verification

- Scoped ESLint passed for the route and its test.
- `git diff --check` passed.
- Full `npm run type-check` remains blocked by 58 pre-existing errors outside
  Task 8; the new route is not listed among them.

## Scope and concerns

- Only the Task 8 route, tests, and this report were changed.
- No writes, deployment, migration, or production retrieval changes were made.
