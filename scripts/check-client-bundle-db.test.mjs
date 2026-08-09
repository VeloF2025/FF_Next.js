#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { findMarkers, run } from "./check-client-bundle-db.mjs";

/** A synthetic .next: chunk contents plus the manifest that maps them to routes. */
function makeBuild(chunks, pages = {}) {
  const root = mkdtempSync(join(tmpdir(), "bundle-db-"));
  for (const [rel, body] of Object.entries(chunks)) {
    const abs = join(root, ".next", rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, "utf8");
  }
  writeFileSync(
    join(root, ".next", "build-manifest.json"),
    JSON.stringify({ pages }),
    "utf8",
  );
  return root;
}

/** Run capturing output so a failing case does not spam the reporter. */
function check(root, knownLeakingRoutes = []) {
  const out = [];
  const status = run({
    root,
    knownLeakingRoutes,
    log: (m) => out.push(String(m)),
    error: (m) => out.push(String(m)),
  });
  return { status, output: out.join("\n") };
}

const CLEAN = 'console.log("just a component");';
const LEAKY = 'throw Error("see https://github.com/neondatabase/serverless/blob/main/CONFIG.md");';

test("findMarkers detects the driver, config, env read and pg parser", () => {
  assert.deepEqual(findMarkers(LEAKY).map((m) => m.name), ["neon-serverless-driver"]);
  assert.deepEqual(findMarkers("x.neonConfig=1").map((m) => m.name), ["neon-config"]);
  assert.deepEqual(findMarkers("e.env.DATABASE_URL").map((m) => m.name), ["database-url"]);
  assert.deepEqual(findMarkers('require("pg-connection-string")').map((m) => m.name), [
    "pg-connection-string",
  ]);
});

test("findMarkers does not fire on ordinary client code", () => {
  assert.deepEqual(findMarkers('const a = "database of records"; useEffect(()=>{})'), []);
});

// The direction that matters. A gate that cannot see the bundle must not
// report success — the old failure mode in this repo was gates that passed
// because they were looking at nothing.
test("fails closed when there is no build", () => {
  const root = mkdtempSync(join(tmpdir(), "bundle-db-nobuild-"));
  try {
    const { status, output } = check(root);
    assert.equal(status, 1);
    assert.match(output, /no build found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when a build directory exists but holds no javascript", () => {
  const root = mkdtempSync(join(tmpdir(), "bundle-db-empty-"));
  try {
    mkdirSync(join(root, ".next", "static"), { recursive: true });
    const { status, output } = check(root);
    assert.equal(status, 1);
    assert.match(output, /no \.js/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("passes on a clean bundle", (t) => {
  const root = makeBuild({ "static/chunks/pages/index-abc.js": CLEAN }, { "/": ["static/chunks/pages/index-abc.js"] });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const { status, output } = check(root);
  assert.equal(status, 0, output);
  assert.match(output, /no database code/);
});

test("fails when a NEW route ships database code", (t) => {
  const root = makeBuild(
    { "static/chunks/pages/reports-abc.js": LEAKY },
    { "/reports": ["static/chunks/pages/reports-abc.js"] },
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const { status, output } = check(root, ["/enhanced-kpis"]);
  assert.equal(status, 1);
  assert.match(output, /newly served to browsers/);
  assert.match(output, /\/reports/);
});

test("passes a known leaking route without hiding that it still leaks", (t) => {
  const root = makeBuild(
    { "static/chunks/pages/kpi-abc.js": LEAKY },
    { "/enhanced-kpis": ["static/chunks/pages/kpi-abc.js"] },
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const { status, output } = check(root, ["/enhanced-kpis"]);
  assert.equal(status, 0, output);
  assert.match(output, /known leaking route/);
  assert.match(output, /\/enhanced-kpis/);
});

// A stale baseline is how a fixed leak silently returns.
test("fails when a baselined route has stopped leaking", (t) => {
  const root = makeBuild(
    { "static/chunks/pages/index-abc.js": CLEAN },
    { "/": ["static/chunks/pages/index-abc.js"] },
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const { status, output } = check(root, ["/enhanced-kpis"]);
  assert.equal(status, 1);
  assert.match(output, /stale/);
  assert.match(output, /\/enhanced-kpis/);
});

// A shared chunk that no manifest claims cannot be pinned to a route, so the
// baseline can never cover it; it has to fail on sight.
test("fails on a leaking chunk that no manifest attributes to a route", (t) => {
  const root = makeBuild({ "static/chunks/orphan-abc.js": LEAKY }, {});
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const { status, output } = check(root, ["/enhanced-kpis"]);
  assert.equal(status, 1);
  assert.match(output, /cannot be baselined/);
});

test("attributes a shared chunk to every route that loads it", (t) => {
  const root = makeBuild(
    { "static/chunks/shared-abc.js": LEAKY },
    { "/a": ["static/chunks/shared-abc.js"], "/b": ["static/chunks/shared-abc.js"] },
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const { status, output } = check(root, []);
  assert.equal(status, 1);
  assert.match(output, /loaded by: \/a, \/b/);
});

test("reads the app router manifest too", (t) => {
  const root = makeBuild({ "static/chunks/app-abc.js": LEAKY }, {});
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, ".next", "app-build-manifest.json"),
    JSON.stringify({ pages: { "/dashboard/page": ["static/chunks/app-abc.js"] } }),
    "utf8",
  );

  const { status, output } = check(root, []);
  assert.equal(status, 1);
  assert.match(output, /\/dashboard\/page/);
});
