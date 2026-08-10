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
 * Entry points that still ship database code.
 *
 * A ratchet, not an allowlist: these are known-BAD and the list must reach
 * empty. Removing an entry is not optional — the gate FAILS when a listed
 * entry stops leaking, so a fix cannot land without shrinking this list, and a
 * fixed leak cannot quietly return behind a stale entry. That has already
 * fired twice for real.
 *
 * ALL REMAINING ENTRIES ARE ONE CHUNK, reached by `next/dynamic` from the
 * projects and staff components, which transitively import staffService /
 * staffNeonService. Lazy is still shipped — it downloads when the component
 * mounts — so this is the same defect as an eager import, only deferred. Fix
 * them by moving those services behind API routes; they will come off this
 * list together, since they share the chunk.
 *
 * Already fixed, kept as the worked examples because they cover the three
 * shapes this defect takes:
 *
 *   barrel collateral   /procurement/boq/new — boqImportService.ts was
 *                       `export * from './import'`, pulling BOQImportEnhanced,
 *                       MaterialMatcher and CategoryMapper in behind the four
 *                       symbols its eight client-component consumers use.
 *
 *   barrel collateral   /procurement/rfq/[id] — the quote-scanner barrel
 *                       re-exported './services', reaching vlmLearningService
 *                       and its module-scope neon(process.env.DATABASE_URL).
 *
 *   dead code           /enhanced-kpis — dashboardStatsService imported `neon`
 *                       behind a lazy `typeof window === 'undefined'` guard,
 *                       for five @deprecated private statics with zero call
 *                       sites. The guard stopped the client being CONSTRUCTED
 *                       in a browser but not the module being IMPORTED, and
 *                       webpack bundles what is imported. Both public methods
 *                       already went through analyticsApi over HTTP, so no API
 *                       route was needed — only deleting 216 lines of dead
 *                       code.
 *
 * Entry points rather than chunk filenames: filenames carry a content hash and
 * change on every build, so a filename baseline would be stale immediately.
 * Dynamic entries are the SOURCE of the `next/dynamic` call, suffixed
 * "(dynamic)", because that is the only attribution react-loadable-manifest
 * gives — and it names the file to go and fix.
 */
export const KNOWN_LEAKING_ROUTES = [
  "pages/projects/[id]/edit.tsx (dynamic)",
  "pages/projects/new.tsx (dynamic)",
  "pages/projects/pipeline/[id].tsx (dynamic)",
  "pages/staff/[id].tsx (dynamic)",
  "pages/staff/[id]/edit.tsx (dynamic)",
  "pages/staff/new.tsx (dynamic)",
  "src/services/staff/import/managerResolver.ts (dynamic)",
  "src/services/staff/import/rowProcessor.ts (dynamic)",
];
