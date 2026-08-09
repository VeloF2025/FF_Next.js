#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findDeclarations, parseBaselines } from "./check-ci-baselines.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_SCRIPT = resolve(HERE, "check-ci-baselines.mjs");

const ENV_BODY = [
  "# canonical",
  "MAX_LINT_WARNINGS=186",
  "MAX_LINT_ERRORS=0",
  "MAX_PAGES_LINT_WARNINGS=1115",
  "MAX_PAGES_LINT_ERRORS=0",
  "MAX_SILENT_CATCHES=78",
  "",
].join("\n");

/** A throwaway git repo containing the checker and a canonical env file. */
function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "ci-baselines-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(SOURCE_SCRIPT, join(root, "scripts", "check-ci-baselines.mjs"));
  writeFileSync(join(root, "scripts", "ci-baselines.env"), ENV_BODY, "utf8");
  // ci-local.sh is structurally required to source the canonical file.
  writeFileSync(
    join(root, "scripts", "ci-local.sh"),
    '#!/bin/bash\n. "$(dirname "$0")/ci-baselines.env"\n',
    "utf8",
  );

  for (const args of [
    ["init", "--quiet"],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "test"],
    ["add", "-A"],
    ["commit", "--quiet", "-m", "fixture"],
  ]) {
    const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args[0]} failed: ${r.stderr}`);
  }
  return root;
}

function addTracked(root, relPath, body) {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, "utf8");
  const r = spawnSync("git", ["-C", root, "add", "-A"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

function runChecker(root) {
  return spawnSync(process.execPath, [join(root, "scripts", "check-ci-baselines.mjs")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI_BASELINES_ROOT: root },
  });
}

test("parseBaselines reads assignments and ignores comments", () => {
  const parsed = parseBaselines("# MAX_LINT_WARNINGS=999\nMAX_LINT_WARNINGS=186\nnoise\n");
  assert.deepEqual(parsed, { MAX_LINT_WARNINGS: 186 });
});

test("findDeclarations matches assignment and --max-warnings forms", () => {
  const keys = ["MAX_LINT_WARNINGS", "MAX_LINT_ERRORS"];
  const found = findDeclarations(
    ["MAX_LINT_WARNINGS=3790", "npm run lint -- --max-warnings 3765", "--max-warnings=12"].join("\n"),
    keys,
    { includeFlagForm: true },
  );
  // Assignments carry the baseline name; flag literals are reported as literals
  // rather than pinned to a key, because with a second warning scope there is
  // no single baseline a bare number can be attributed to.
  assert.deepEqual(
    found.map((f) => [f.key, f.value, Boolean(f.literal)]),
    [
      ["MAX_LINT_WARNINGS", 3790, false],
      ["(literal flag)", 3765, true],
      ["(literal flag)", 12, true],
    ],
  );
});

test("findDeclarations tells MAX_PAGES_LINT_WARNINGS apart from MAX_LINT_WARNINGS", () => {
  const keys = ["MAX_LINT_WARNINGS", "MAX_PAGES_LINT_WARNINGS"];
  const found = findDeclarations("MAX_PAGES_LINT_WARNINGS=1115\nMAX_LINT_WARNINGS=186\n", keys);
  assert.deepEqual(
    found.map((f) => [f.key, f.value]),
    [
      ["MAX_PAGES_LINT_WARNINGS", 1115],
      ["MAX_LINT_WARNINGS", 186],
    ],
  );
});

test("findDeclarations ignores the flag form outside ratchet gates", () => {
  const found = findDeclarations("eslint src --max-warnings 0\n", ["MAX_LINT_WARNINGS"]);
  assert.deepEqual(found, []);
});

test("findDeclarations does not match a longer surrounding identifier", () => {
  const found = findDeclarations("FOO_MAX_LINT_ERRORS=77\n", ["MAX_LINT_ERRORS"]);
  assert.deepEqual(found, []);
});

test("passes when every declaration agrees", (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  // deploy-local-main.sh keeps literals on purpose (it runs outside the repo),
  // so they must agree. ci.yml sources instead of restating.
  addTracked(root, "scripts/deploy-local-main.sh", "MAX_LINT_WARNINGS=186\nMAX_LINT_ERRORS=0\n");
  addTracked(
    root,
    ".github/workflows/ci.yml",
    'run: |\n  . scripts/ci-baselines.env\n  npm run lint -- --max-warnings "$MAX_LINT_WARNINGS"\n',
  );

  const result = runChecker(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CI baselines consistent/);
});

test("fails on a disagreeing shell assignment and names file, line and both values", (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  addTracked(root, "scripts/deploy-local-main.sh", "#!/bin/bash\nMAX_LINT_WARNINGS=3825\n");

  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /scripts\/deploy-local-main\.sh:2/);
  assert.match(result.stderr, /found 3825, canonical is 186/);
});

test("fails on a hard-coded --max-warnings inside a ratchet gate", (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  addTracked(
    root,
    ".github/workflows/ci.yml",
    "steps:\n  - run: . scripts/ci-baselines.env && npm run lint -- --max-warnings 3765\n",
  );

  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ci\.yml:2/);
  assert.match(result.stderr, /3765 is hard-coded/);
});

// The regression this closes: while `--max-warnings` was pinned to
// MAX_LINT_WARNINGS, a literal equal to the src baseline PASSED even when it
// was sitting on the pages gate — where it would have demanded 186 warnings
// from a scope that legitimately emits 1115, i.e. permanently red. A literal is
// wrong in a ratchet gate no matter which canonical value it happens to equal.
test("rejects a --max-warnings literal even when it equals a canonical value", (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  addTracked(
    root,
    ".github/workflows/ci.yml",
    "steps:\n  - run: . scripts/ci-baselines.env && npm run lint:pages -- --max-warnings 186\n",
  );

  const result = runChecker(root);
  assert.equal(result.status, 1, `expected failure, got:\n${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /186 is hard-coded/);
});

test("fails on a disagreeing pages baseline assignment", (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  addTracked(root, "scripts/deploy-local-main.sh", "#!/bin/bash\nMAX_PAGES_LINT_WARNINGS=9999\n");

  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /scripts\/deploy-local-main\.sh:2/);
  assert.match(result.stderr, /found 9999, canonical is 1115/);
});

// `--max-warnings 0` is a deliberate STRICTER policy in package.json's
// lint:strict and in zero-tolerance-check.cjs. Dragging those to the ratchet
// value would silently loosen two real gates.
test("allows a stricter --max-warnings outside the ratchet gates", (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  addTracked(root, "package.json", '{ "scripts": { "lint:strict": "eslint src --max-warnings 0" } }\n');
  addTracked(root, "scripts/zero-tolerance-check.cjs", "execSync('npx eslint src --max-warnings 0');\n");

  const result = runChecker(root);
  assert.equal(result.status, 0, result.stderr);
});

test("ignores disabled workflows and archived docs", (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  addTracked(root, ".github/workflows-disabled/ci.yml", "run: npm run lint -- --max-warnings 3765\n");
  addTracked(root, "docs/archive/reports/old.md", "MAX_LINT_WARNINGS=999\n");
  addTracked(root, "docs/superpowers/plans/plan.md", "npm run lint -- --max-warnings 0\n");

  const result = runChecker(root);
  assert.equal(result.status, 0, result.stderr);
});

test("fails when ci-local.sh stops sourcing the canonical file", (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  addTracked(root, "scripts/ci-local.sh", "#!/bin/bash\nMAX_LINT_WARNINGS=186\n");

  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must source scripts\/ci-baselines\.env/);
});

test("ignores historical values in handoff notes", (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  addTracked(root, ".claude/handoffs/2026-05-11.md", "bumped MAX_LINT_WARNINGS=180 back then\n");

  const result = runChecker(root);
  assert.equal(result.status, 0, result.stderr);
});

test("ignores untracked files", (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  // Written but never `git add`-ed.
  writeFileSync(join(root, "scratch.sh"), "MAX_LINT_ERRORS=77\n", "utf8");

  const result = runChecker(root);
  assert.equal(result.status, 0, result.stderr);
});

// The synthetic-fixture tests above all passed while the real invocation
// failed: the checker scanned its own test file and read these fixture
// literals as live declarations, which only became visible once the file was
// git-tracked. Assert against the actual checkout, not just a temp repo.
test("passes against the real repository checkout", () => {
  const repoRoot = resolve(HERE, "..");
  const result = spawnSync(process.execPath, [SOURCE_SCRIPT], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, CI_BASELINES_ROOT: repoRoot },
  });
  assert.equal(result.status, 0, `checker failed on the real repo:\n${result.stderr}${result.stdout}`);
});

test("a MUST_SOURCE file that only mentions the env file in a comment fails", (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  addTracked(root, "scripts/ci-local.sh", "#!/bin/bash\n# see ci-baselines.env for the values\n");

  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must source scripts\/ci-baselines\.env/);
});

test("detects a drifted assignment written with spaces around =", () => {
  const found = findDeclarations("MAX_LINT_WARNINGS = 3790\n", ["MAX_LINT_WARNINGS"]);
  assert.deepEqual(
    found.map((f) => [f.key, f.value]),
    [["MAX_LINT_WARNINGS", 3790]],
  );
});

test("fails when the canonical file is missing", (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  rmSync(join(root, "scripts", "ci-baselines.env"));
  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing canonical baseline file/);
});
