<!-- Copilot instructions auto-generated from CLAUDE.md by /portability. -->
<!-- Canonical source: CLAUDE.md — do not edit manually. -->

# GitHub Copilot Instructions — FibreFlow Next.js

Fiber network project management application for Velocity Fibre.

## Tech Stack

- Next.js 14+ (Pages Router primary, App Router for new routes), TypeScript.
- Auth: PostgreSQL-based RBAC. No Clerk/Auth0/NextAuth.
- Database: Self-hosted Supabase Postgres on `localhost:5437` (Velocity). Single DB shared by dev + production.
- Storage: VF Storage at `100.96.203.105:8091`.
- Test: Vitest (unit), Playwright (E2E).
- **npm is canonical** — never `bun install`.

## Behavioral principles

- Think before coding. State assumptions; list interpretations and ask which one — don't guess.
- Simplicity first. Minimum code that solves the problem. No speculative abstractions.
- Surgical changes. Touch only what the task requires. Don't refactor adjacent code.
- Verify before claiming done. Run the test/lint/build command in the same message as the change. Forbidden without evidence: "should work", "looks good", "Done!", "Perfect!".

## Code Standards

- 100% TypeScript types — no implicit `any`.
- Files < 300 lines; components < 200 lines.
- No `console.log` — use `log` from `@/lib/logger`.
- No empty catch blocks — always log and handle.
- Wait for server confirmation before showing success toasts.

## Critical Rules

- Use specific dynamic param names (`[projectId]`, not `[id]`).
- Nested dynamic API routes FAIL on Vercel — flatten them.
- No conditional SQL fragments via the Neon serverless shim — breaks `lib/db/pool.js` callers.
- Prefer `pg.Pool` via `@/lib/db` for new DB code; `@neondatabase/serverless` is tech debt.
- Never commit `CLAUDE.local.md` — local-only override, may contain secrets.
- Multi-page modules MUST use the `ModuleNav` horizontal nav bar — no sidebar sub-trees.

## API Conventions

```typescript
import { apiResponse } from '@/lib/apiResponse';
return apiResponse.success(res, data);
return apiResponse.notFound(res, 'Resource', id);
```

API routes live in `pages/api/` (Pages Router) and `src/app/api/` (App Router).

## Quality Gates

```bash
npm run ci:quick    # Lint ratchet + type-check (mandatory before PRs)
npm run lint
npm run type-check
npm test
```
