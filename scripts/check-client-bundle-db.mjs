#!/usr/bin/env node
//
// check-client-bundle-db.mjs — fail when database code ships to the browser.
//
// This asks the question `no-direct-db-connections` was always trying to ask,
// but reads the answer off the build instead of inferring it from imports.
//
// Why not static analysis
// -----------------------
// Import reachability over-approximates badly. Measured on 6c6d423dd: 32
// modules were reachable from client entry points, and exactly ONE reached a
// browser chunk — Next strips `getServerSideProps`-only imports and webpack
// tree-shakes the rest. A gate on reachability would have been 31 false
// positives, which is how gates acquire allowlists. "Module scope" was tried
// as a refinement and predicts no better: 16 of the 32 construct at module
// scope, still only one shipped.
//
// The emitted chunks have no such ambiguity. If a marker is in .next/static it
// is served to browsers, full stop — no allowlist, no reasoning about bundler
// behaviour, no judgement call about whether a file is "server-side".
//
// What it found on its first run
// ------------------------------
// Three pages shipped the 144KB @neondatabase/serverless driver:
// /enhanced-kpis, /procurement/boq/new and /procurement/rfq/[id]. The last
// also ran `neon(process.env.DATABASE_URL)` at module scope in the browser,
// reached via pages/procurement/rfq/[id].tsx -> the quote-scanner barrel ->
// quoteExtractionService -> vlmLearningService.ts:31. No credential was
// exposed — Next only inlines NEXT_PUBLIC_* — but the driver was real weight
// and the client construction was real dead code. The previous gate could not
// see any of it: it excluded `services/` by directory name.
//
// Usage:
//   node scripts/check-client-bundle-db.mjs           # after a build
//   node scripts/check-client-bundle-db.mjs --list    # print markers
//
// Requires a build. It FAILS rather than skips when .next/static is absent:
// a guard that passes when it cannot see anything is worse than no guard.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const DEFAULT_ROOT = resolve(process.env.BUNDLE_DB_ROOT ?? join(HERE, ".."));

/**
 * Markers that only appear when a database driver was bundled.
 *
 * Chosen to survive minification: every one is either a string literal the
 * minifier must preserve (error text, documentation URLs) or a property name
 * that is not mangled because it is read off `process.env`. Identifier-based
 * matching would not survive — `neon(...)` minifies to a single letter.
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
    name: "pg-connection-string",
    pattern: /pg-connection-string/,
    why: "the node-postgres connection parser is bundled",
  },
];

function walkJs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stats = statSync(full);
    if (stats.isDirectory()) walkJs(full, out);
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

/**
 * chunk path (as written in a manifest) -> the routes that load it.
 *
 * Both routers are read: build-manifest.json covers pages/, and
 * app-build-manifest.json covers app/. A hit with no attribution is still a
 * violation — it is served either way — so a missing manifest never downgrades
 * a finding, it only makes the message less specific.
 */
export function chunkToRoutes(root) {
  const map = new Map();
  const add = (chunk, route) => {
    const key = chunk.replace(/^\/+/, "");
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(route);
  };

  const pagesManifest = join(root, ".next", "build-manifest.json");
  if (existsSync(pagesManifest)) {
    const manifest = JSON.parse(readFileSync(pagesManifest, "utf8"));
    for (const [route, chunks] of Object.entries(manifest.pages ?? {})) {
      for (const chunk of chunks) add(chunk, route);
    }
  }

  const appManifest = join(root, ".next", "app-build-manifest.json");
  if (existsSync(appManifest)) {
    const manifest = JSON.parse(readFileSync(appManifest, "utf8"));
    for (const [route, chunks] of Object.entries(manifest.pages ?? {})) {
      for (const chunk of chunks) add(chunk, route);
    }
  }

  return map;
}

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

export function run({
  root = DEFAULT_ROOT,
  log = console.log,
  error = console.error,
  knownLeakingRoutes = KNOWN_LEAKING_ROUTES,
} = {}) {
  const staticDir = join(root, ".next", "static");
  if (!existsSync(staticDir)) {
    error(`✗ no build found at ${relative(root, staticDir) || ".next/static"}`);
    error("  This gate reads the emitted client bundle, so it cannot run without one.");
    error("  Run `npm run build` first. Failing rather than skipping is deliberate:");
    error("  a guard that passes when it can see nothing is worse than no guard.");
    return 1;
  }

  const files = walkJs(staticDir);
  if (files.length === 0) {
    error(`✗ ${relative(root, staticDir)} contains no .js — the build looks incomplete`);
    return 1;
  }

  const routes = chunkToRoutes(root);
  const violations = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const hits = findMarkers(source);
    if (hits.length === 0) continue;
    // Manifests refer to chunks as `static/chunks/...`, i.e. relative to .next.
    const manifestKey = relative(join(root, ".next"), file).replace(/\\/g, "/");
    violations.push({
      file: relative(root, file).replace(/\\/g, "/"),
      markers: hits,
      routes: [...(routes.get(manifestKey) ?? [])].sort(),
    });
  }

  const describe = (violation) => {
    error(`  ${violation.file}`);
    for (const marker of violation.markers) error(`    ${marker.name}: ${marker.why}`);
    error(
      violation.routes.length > 0
        ? `    loaded by: ${violation.routes.join(", ")}`
        : "    loaded by: (not attributed to a route)",
    );
  };

  const advice =
    "\n  A module that opens a database connection must not be reachable from a\n" +
    "  client component. Move the query behind an API route and fetch it, or split\n" +
    "  the barrel so the component imports only what it renders.\n";

  // A chunk no manifest claims cannot be pinned to a route, so it can never be
  // covered by the baseline — it fails on sight.
  const unattributed = violations.filter((v) => v.routes.length === 0);
  const leakingRoutes = [...new Set(violations.flatMap((v) => v.routes))].sort();
  const known = [...knownLeakingRoutes].sort();
  const newRoutes = leakingRoutes.filter((r) => !known.includes(r));
  const fixedRoutes = known.filter((r) => !leakingRoutes.includes(r));

  if (newRoutes.length > 0 || unattributed.length > 0) {
    error("\n✗ database code newly served to browsers\n");
    for (const violation of violations) {
      if (violation.routes.length === 0 || violation.routes.some((r) => newRoutes.includes(r))) {
        describe(violation);
      }
    }
    if (newRoutes.length > 0) error(`\n  new leaking route(s): ${newRoutes.join(", ")}`);
    if (unattributed.length > 0) error("  plus chunk(s) no manifest claims, which cannot be baselined");
    error(advice);
    return 1;
  }

  if (fixedRoutes.length > 0) {
    error(`\n✗ KNOWN_LEAKING_ROUTES is stale — no longer leaking: ${fixedRoutes.join(", ")}\n`);
    error("  Remove them from KNOWN_LEAKING_ROUTES in this file. The list is a ratchet:");
    error("  leaving a fixed route in it would let the leak silently come back.\n");
    return 1;
  }

  if (leakingRoutes.length > 0) {
    log(
      `⚠ no NEW database code in the client bundle — ${files.length} chunk(s) scanned; ` +
        `${leakingRoutes.length} known leaking route(s) still to fix: ${leakingRoutes.join(", ")}`,
    );
    return 0;
  }

  log(`✓ no database code in the client bundle — ${files.length} chunk(s) scanned`);
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  if (process.argv.includes("--list")) {
    for (const marker of MARKERS) console.log(`${marker.name}\t${marker.pattern}`);
    process.exit(0);
  }
  process.exit(run());
}
