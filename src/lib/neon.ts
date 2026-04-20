// Unified DB access: re-exports the canonical pg.Pool-backed `sql` and
// `transaction` helpers from src/lib/db-pool.ts.
//
// Prior version routed through ../../lib/db/pool.js, which in turn imported
// @neondatabase/serverless. That chain relied on the Next.js webpack alias
// (neon-shim) to swap in a pg-backed client at build time — fragile for
// anything that isn't bundled by Next (tsx scripts, tests, ad-hoc tools).
// Re-exporting from src/lib/db-pool.ts removes the indirection and the
// build-time alias dependency.
//
// IMPORTANT: server-only. Do not import from browser/client components.

export { sql, transaction } from './db-pool';