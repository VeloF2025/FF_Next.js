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

import { KNOWN_LEAKING_ROUTES, MARKERS, findMarkers } from "./client-bundle-db-policy.mjs";

// Re-exported so this module stays the single entry point for callers.
export { KNOWN_LEAKING_ROUTES, MARKERS, findMarkers };

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const DEFAULT_ROOT = resolve(process.env.BUNDLE_DB_ROOT ?? join(HERE, ".."));

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

  // A manifest we cannot parse is not an empty manifest. Falling back to "no
  // routes" would silently turn every attributed leak into an unattributed
  // one; throwing here surfaces it as a build problem instead.
  const load = (name) => {
    const path = join(root, ".next", name);
    if (!existsSync(path)) return;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path, "utf8"));
    } catch (cause) {
      throw new Error(`cannot read ${name}: ${cause.message}`, { cause });
    }
    for (const [route, chunks] of Object.entries(manifest.pages ?? {})) {
      if (!Array.isArray(chunks)) continue;
      for (const chunk of chunks) if (typeof chunk === "string") add(chunk, route);
    }
  };

  load("build-manifest.json");
  load("app-build-manifest.json");

  // Lazily-loaded chunks appear in NEITHER of the above. `next/dynamic` records
  // them here instead, keyed "<page> -> <imported module>" with a `files` list.
  //
  // Without this, a dynamic import that pulls a driver produced an
  // unattributed chunk, which this gate fails on but cannot name a route for —
  // and that is exactly what happened: removing the eager path from
  // /enhanced-kpis left the same driver chunk reachable from eight
  // `next/dynamic` imports across the projects, staff and pipeline pages,
  // which had been masked while the chunk was also loaded eagerly. Lazy is
  // still shipped; it downloads when the component mounts.
  const loadable = join(root, ".next", "react-loadable-manifest.json");
  if (existsSync(loadable)) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(loadable, "utf8"));
    } catch (cause) {
      throw new Error(`cannot read react-loadable-manifest.json: ${cause.message}`, { cause });
    }
    for (const [key, entry] of Object.entries(manifest)) {
      const page = String(key).split(" -> ")[0].trim();
      if (!page || !Array.isArray(entry?.files)) continue;
      for (const chunk of entry.files) if (typeof chunk === "string") add(chunk, `${page} (dynamic)`);
    }
  }

  return map;
}

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

  // A broken symlink or an unreadable subdirectory would otherwise abort the
  // walk with a raw stack trace. Still fail-closed either way, but the deploy
  // log should say which path it choked on.
  let files;
  try {
    files = walkJs(staticDir);
  } catch (err) {
    error(`✗ cannot enumerate ${relative(root, staticDir)}: ${err.message}`);
    error("  Refusing to pass a bundle this gate could not scan in full.");
    return 1;
  }
  if (files.length === 0) {
    error(`✗ ${relative(root, staticDir)} contains no .js — the build looks incomplete`);
    return 1;
  }

  // Anything unreadable — a corrupt manifest, a broken symlink, a permission
  // error — is reported as a gate failure with the reason, rather than as a
  // raw stack trace. It already exited non-zero via the uncaught handler; this
  // just makes the deploy log say why.
  let routes;
  try {
    routes = chunkToRoutes(root);
  } catch (err) {
    error(`✗ ${err.message}`);
    error("  The build output is unreadable, so this gate cannot vouch for it.");
    return 1;
  }

  const violations = [];

  for (const file of files) {
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch (err) {
      error(`✗ cannot read ${relative(root, file)}: ${err.message}`);
      error("  Refusing to pass a bundle this gate could not scan in full.");
      return 1;
    }
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
