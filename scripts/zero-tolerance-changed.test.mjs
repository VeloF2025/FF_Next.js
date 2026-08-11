#!/usr/bin/env node
// Tests for scripts/zero-tolerance-changed.sh — CLAUDE.md rule 12 on changed files.
//
// This gate's failure mode is a false NEGATIVE: an empty changed-file set reads
// exactly like a clean one. That is not hypothetical — the --worktree mode sees
// nothing once changes are committed, so the local gate has been scanning an
// empty set for anyone who runs ci:quick after committing. Every case here
// asserts on the exit status, because that is all CI reads.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_SCRIPT = resolve(HERE, "zero-tolerance-changed.sh");

const ZERO_SHA = "0".repeat(40);

// Assembled so this file does not trip the very checks it exercises, the same
// way the secret-scan tests avoid spelling out credentials.
const CONSOLE_CALL = ["console", ".", "log"].join("") + "('x');";
const EMPTY_CATCH = "try { f(); } catch (e) {" + "}";

function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "zero-tolerance-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(SOURCE_SCRIPT, join(root, "scripts", "zero-tolerance-changed.sh"));
  writeFileSync(join(root, "clean.ts"), "export const a = 1;\n", "utf8");

  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "ci@example.com"]);
  git(root, ["config", "user.name", "ci"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "--quiet", "-m", "baseline"]);
  return root;
}

function commitFile(root, name, body) {
  writeFileSync(join(root, name), body, "utf8");
  git(root, ["add", "-A"]);
  git(root, ["commit", "--quiet", "-m", `add ${name}`]);
}

function run(root, args) {
  return spawnSync("bash", ["scripts/zero-tolerance-changed.sh", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

function withFixture(body) {
  const root = createFixture();
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function describe(r) {
  return `exit=${r.status}\n${r.stdout}${r.stderr}`;
}

test("--range flags a console call added on the branch", () => {
  withFixture((root) => {
    const base = git(root, ["rev-parse", "HEAD"]);
    commitFile(root, "feature.ts", `export function f() { ${CONSOLE_CALL} }\n`);
    const r = run(root, ["--range", base, "HEAD"]);
    assert.equal(r.status, 1, `expected a detection: ${describe(r)}`);
    assert.match(r.stdout, /feature\.ts/);
  });
});

test("--range flags an empty catch block", () => {
  withFixture((root) => {
    const base = git(root, ["rev-parse", "HEAD"]);
    commitFile(root, "feature.ts", `export function f() { ${EMPTY_CATCH} }\n`);
    const r = run(root, ["--range", base, "HEAD"]);
    assert.equal(r.status, 1, `expected a detection: ${describe(r)}`);
    assert.match(r.stdout, /Empty catch/);
  });
});

test("--range ignores a console call that predates the branch", () => {
  withFixture((root) => {
    // The violation is in the base, so it is pre-existing debt and not this
    // change's problem. Rule 12 scopes zero-tolerance to CHANGED code.
    commitFile(root, "legacy.ts", `export function f() { ${CONSOLE_CALL} }\n`);
    const base = git(root, ["rev-parse", "HEAD"]);
    commitFile(root, "feature.ts", "export const b = 2;\n");
    const r = run(root, ["--range", base, "HEAD"]);
    assert.equal(r.status, 0, `pre-existing debt must not block: ${describe(r)}`);
  });
});

test("--range honours the eslint-disable-line no-console pragma", () => {
  withFixture((root) => {
    const base = git(root, ["rev-parse", "HEAD"]);
    commitFile(
      root,
      "feature.ts",
      `export function f() { ${CONSOLE_CALL} // eslint-disable-line no-console\n}\n`,
    );
    const r = run(root, ["--range", base, "HEAD"]);
    assert.equal(r.status, 0, `documented exception must pass: ${describe(r)}`);
  });
});

test("--range honours the eslint-disable-next-line pragma on the previous line", () => {
  withFixture((root) => {
    const base = git(root, ["rev-parse", "HEAD"]);
    commitFile(
      root,
      "feature.ts",
      `export function f() {\n  // eslint-disable-next-line no-console\n  ${CONSOLE_CALL}\n}\n`,
    );
    const r = run(root, ["--range", base, "HEAD"]);
    assert.equal(r.status, 0, `next-line pragma must pass: ${describe(r)}`);
  });
});

test("--range skips console calls in test files but still flags empty catches there", () => {
  withFixture((root) => {
    const base = git(root, ["rev-parse", "HEAD"]);
    commitFile(root, "thing.test.ts", `it('x', () => { ${CONSOLE_CALL} });\n`);
    assert.equal(run(root, ["--range", base, "HEAD"]).status, 0, "console is allowed in tests");

    const base2 = git(root, ["rev-parse", "HEAD"]);
    commitFile(root, "other.test.ts", `it('y', () => { ${EMPTY_CATCH} });\n`);
    const r = run(root, ["--range", base2, "HEAD"]);
    // Matches the original gate: an empty catch swallows a failure just as
    // silently in a test as in production, so tests are NOT exempt from it.
    assert.equal(r.status, 1, `empty catch in a test must fail: ${describe(r)}`);
  });
});

test("--range flags a MULTI-LINE empty catch block", () => {
  withFixture((root) => {
    const base = git(root, ["rev-parse", "HEAD"]);
    // The way people actually write it. The old line-oriented grep required
    // both braces on one line and never saw this form at all.
    commitFile(root, "feature.ts", "export function f() {\n  try {\n    g();\n  } catch (e) {\n  }\n}\n");
    const r = run(root, ["--range", base, "HEAD"]);
    assert.equal(r.status, 1, `multi-line empty catch must be detected: ${describe(r)}`);
    assert.match(r.stdout, /Empty catch/);
  });
});

test("--range does NOT flag a catch that actually handles the error", () => {
  withFixture((root) => {
    const base = git(root, ["rev-parse", "HEAD"]);
    commitFile(
      root,
      "feature.ts",
      "export function f() {\n  try {\n    g();\n  } catch (e) {\n    report(e);\n  }\n}\n",
    );
    const r = run(root, ["--range", base, "HEAD"]);
    assert.equal(r.status, 0, `a handled catch must pass: ${describe(r)}`);
  });
});

test("--range still scans a production file whose name contains 'test'", () => {
  withFixture((root) => {
    const base = git(root, ["rev-parse", "HEAD"]);
    // `grep -v '.test.'` unescaped matches any-char + "test" + any-char, which
    // exempted latestUtils.ts, ContestEntry.ts, AttestationForm.ts and friends
    // from the console check entirely.
    commitFile(root, "latestUtils.ts", `export function f() { ${CONSOLE_CALL} }\n`);
    const r = run(root, ["--range", base, "HEAD"]);
    assert.equal(r.status, 1, `production file with 'test' in the name must be scanned: ${describe(r)}`);
    assert.match(r.stdout, /latestUtils\.ts/);
  });
});

test("--range still exempts a genuine .test.ts file from the console check", () => {
  withFixture((root) => {
    const base = git(root, ["rev-parse", "HEAD"]);
    commitFile(root, "thing.spec.ts", `it('x', () => { ${CONSOLE_CALL} });\n`);
    const r = run(root, ["--range", base, "HEAD"]);
    assert.equal(r.status, 0, `real spec file must stay exempt: ${describe(r)}`);
  });
});

test("--range survives a deletion-only change", () => {
  withFixture((root) => {
    commitFile(root, "doomed.ts", "export const c = 3;\n");
    const base = git(root, ["rev-parse", "HEAD"]);
    git(root, ["rm", "--quiet", "doomed.ts"]);
    git(root, ["commit", "--quiet", "-m", "delete"]);
    const r = run(root, ["--range", base, "HEAD"]);
    // The file is in the diff but not on disk. Without the `|| true` guard,
    // pipefail kills the gate here instead of passing it.
    assert.equal(r.status, 0, `deletion-only change must not error: ${describe(r)}`);
  });
});

test("--range refuses an unresolvable base instead of scanning nothing", () => {
  withFixture((root) => {
    commitFile(root, "feature.ts", `export function f() { ${CONSOLE_CALL} }\n`);
    const r = run(root, ["--range", ZERO_SHA, "HEAD"]);
    assert.notEqual(r.status, 0, `unresolvable base must fail the build: ${describe(r)}`);
    // Match the success sentinel, not the word "clean" — the failure message
    // itself says "refusing to report a clean gate".
    assert.doesNotMatch(r.stdout, /✅ Zero Tolerance/);
  });
});

test("--worktree flags an uncommitted console call", () => {
  withFixture((root) => {
    writeFileSync(join(root, "wip.ts"), `export function f() { ${CONSOLE_CALL} }\n`, "utf8");
    git(root, ["add", "-A"]);
    const r = run(root, ["--worktree"]);
    assert.equal(r.status, 1, `expected a detection: ${describe(r)}`);
  });
});

test("an unknown mode is an error, not a pass", () => {
  withFixture((root) => {
    const r = run(root, ["--everything"]);
    assert.notEqual(r.status, 0, `unknown mode must not pass: ${describe(r)}`);
  });
});
