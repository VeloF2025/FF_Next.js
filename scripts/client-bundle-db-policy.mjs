#!/usr/bin/env node
//
// client-bundle-db-policy.mjs — WHAT counts as database code in a browser
// bundle, and WHICH routes are already known to carry it.
//
// Split from check-client-bundle-db.mjs, which owns the mechanism: walking
// .next/static, parsing the build manifests, reporting. The two change for
// different reasons and at different rates. This file changes when a driver is
// adopted or a leak is fixed; the scanner does not change at all for either.

/**
 * Markers that only appear when a database driver was bundled.
 *
 * Chosen to survive minification: every one is either a string literal the
 * minifier must preserve (error text, documentation URLs, package names in an
 * inlined manifest) or a property name that is not mangled because it is read
 * off `process.env`. Identifier matching would not survive — `neon(...)`
 * minifies to a single letter.
 *
 * KNOWN LIMIT — this is a detector for the drivers this repo actually uses,
 * not a general one. `pg` itself carries none of these strings, and neither
 * would Prisma, Drizzle or postgres.js if adopted; the entries for those exist
 * so adoption trips the gate rather than slipping past it, but a driver
 * reading a differently-named variable (PGHOST/PGPASSWORD, POSTGRES_URL) is
 * covered only by the env markers below. Two things narrow that gap today:
 * `pg` cannot reach a client chunk at all, because next.config.js sets no
 * `resolve.fallback` for `net`/`tls`/`fs` and the build hard-fails on the
 * attempt; and any new driver arrives through a dependency change, which is a
 * reviewed event. Add a marker when a driver is added.
 */
export const MARKERS = [
  {
    name: "neon-serverless-driver",
    pattern: /neondatabase\/serverless/,
    why: "the @neondatabase/serverless driver itself is in this chunk",
  },
  {
    name: "neon-config",
    pattern: /neonConfig\b/,
    why: "driver configuration API is referenced",
  },
  {
    name: "database-url",
    pattern: /\bDATABASE_URL\b/,
    why: "a connection string is read in browser-served code",
  },
  {
    // Matched the inlined dependency manifest of @neondatabase/serverless in
    // the first real run, not executing parser code — hence the wording. It is
    // still a database driver's fingerprint either way.
    name: "pg-connection-string",
    pattern: /pg-connection-string/,
    why: "a Postgres connection-string parser is bundled, or named in a bundled dependency manifest",
  },
  {
    name: "prisma-client",
    pattern: /\bPrismaClient\b/,
    why: "the Prisma client is in this chunk",
  },
  {
    name: "drizzle-orm",
    pattern: /drizzle-orm/,
    why: "Drizzle, which talks to the database directly, is in this chunk",
  },
  {
    name: "postgres-env",
    pattern: /\b(?:PGPASSWORD|PGHOST|POSTGRES_URL)\b/,
    why: "Postgres connection settings are read in browser-served code",
  },
];

/** Every marker present in `source`. Exported so the tests can drive it directly. */
export function findMarkers(source) {
  return MARKERS.filter((marker) => marker.pattern.test(source));
}

/**
 * Routes that already ship database code, measured on 6c6d423dd.
 *
 * A ratchet, not an allowlist: these are known-BAD and the list must shrink to
 * empty. Each is a client component calling a service that opens its own
 * connection, so fixing one means moving that work behind an API route —
 * separate work from installing this gate, and the gate is worth having in the
 * meantime because it stops a FOURTH from appearing.
 *
 *   /enhanced-kpis          useDashboardData.ts:65 calls
 *                           DashboardStatsService.getDashboardStats() from a
 *                           React hook.
 *   /procurement/boq/new    boqImportService.ts:9 is `export * from './import'`,
 *                           pulling three DB modules through a barrel into
 *                           BOQUpload.tsx.
 *   /procurement/rfq/[id]   quoteExtractionService calls buildVlmFewShotPrompt
 *                           and recordCorrectExtraction from vlmLearningService,
 *                           which runs neon(process.env.DATABASE_URL) at module
 *                           scope — the one case that reached module-scope
 *                           construction in the browser.
 *
 * Routes rather than chunk filenames: filenames carry a content hash and change
 * on every build, so a filename baseline would be stale immediately.
 */
export const KNOWN_LEAKING_ROUTES = [
  "/enhanced-kpis",
  "/procurement/boq/new",
  "/procurement/rfq/[id]",
];
