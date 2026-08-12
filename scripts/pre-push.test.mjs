#!/usr/bin/env node
// Tests for scripts/pre-push.sh — the hook installed by scripts/install-hooks.sh.
//
// This hook blocks every push and carries three independent guards, so it fails
// in two opposite and equally bad directions:
//
//   silently never firing  -> a gate that reports success having checked nothing
//   erroring or over-blocking -> nobody can push at all
//
// Both are covered below. The suite exists because a blind review found that
// `git push --delete` was rejected with "auth isolation violation" — a routine
// operation blocked by a security gate, with a message that named the wrong
// cause. A suite shaped like this one would have caught it directly, and now
// does (see "deletion push").
//
// Built the same way as scripts/secret-scan.test.mjs: spawn the real script with
// crafted stdin, assert on the real exit code. A pre-push hook receives
// `<local ref> <local sha> <remote ref> <remote sha>` lines on stdin.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(HERE, "pre-push.sh");
const SCANNER = resolve(HERE, "secret-scan.sh");

const ZERO = "0".repeat(40);

// Assembled from fragments so this file does not trip the secret scan it drives.
const CREDENTIAL_LINE =
  'const u = "postgresql://ff_user:' + "Kx9mQ2vTn7Lp" + '@100.96.0.1:5437/db";';
const AUTH_VIOLATION_LINE = "const userId = " + "'dev-user-1'" + ";";

function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * A throwaway repo with the hook, the scanner it calls, and an `origin/master`
 * ref — which the hook needs for its new-branch range calculation.
 */
function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "pre-push-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(HOOK, join(root, "scripts", "pre-push.sh"));
  copyFileSync(SCANNER, join(root, "scripts", "secret-scan.sh"));
  writeFileSync(join(root, "README.md"), "fixture\n", "utf8");

  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "ci@example.com"]);
  git(root, ["config", "user.name", "ci"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "--quiet", "-m", "baseline"]);
  git(root, ["update-ref", "refs/remotes/origin/master", git(root, ["rev-parse", "HEAD"])]);
  return root;
}

function commitFile(root, name, body) {
  const full = join(root, name);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, "utf8");
  git(root, ["add", "-A"]);
  git(root, ["commit", "--quiet", "-m", `add ${name}`]);
  return git(root, ["rev-parse", "HEAD"]);
}

/**
 * Run the hook as git does: ref lines on stdin, remote name and URL as argv.
 *
 * CLAUDECODE and ALLOW_MASTER_PUSH are stripped unless a test sets them. Both
 * are commonly set in the ambient environment, and either one makes the
 * master-protection guard pass everything — a test suite that inherited them
 * would report the guard working while never exercising it.
 */
function runHook(root, refLines, env = {}) {
  return spawnSync("bash", ["scripts/pre-push.sh", "origin", "https://example.invalid"], {
    cwd: root,
    encoding: "utf8",
    input: Array.isArray(refLines) ? refLines.join("\n") + "\n" : refLines,
    env: { ...process.env, CLAUDECODE: "", ALLOW_MASTER_PUSH: "", ...env },
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

// ── GUARD 1: master/main protection ─────────────────────────────────────────

test("blocks a non-interactive push to master", () => {
  withFixture((root) => {
    const head = git(root, ["rev-parse", "HEAD"]);
    const r = runHook(root, [`refs/heads/master ${head} refs/heads/master ${head}`]);
    assert.equal(r.status, 1, `master push must be blocked: ${describe(r)}`);
    assert.match(r.stdout, /BLOCKED: Direct push to master/);
  });
});

test("blocks a non-interactive push to main", () => {
  withFixture((root) => {
    const head = git(root, ["rev-parse", "HEAD"]);
    const r = runHook(root, [`refs/heads/main ${head} refs/heads/main ${head}`]);
    assert.equal(r.status, 1, `main push must be blocked: ${describe(r)}`);
  });
});

test("ALLOW_MASTER_PUSH=1 permits a push to master", () => {
  withFixture((root) => {
    const head = git(root, ["rev-parse", "HEAD"]);
    const r = runHook(root, [`refs/heads/master ${head} refs/heads/master ${head}`], {
      ALLOW_MASTER_PUSH: "1",
    });
    assert.equal(r.status, 0, `documented override must work: ${describe(r)}`);
  });
});

test("CLAUDECODE=1 permits a push to master", () => {
  withFixture((root) => {
    const head = git(root, ["rev-parse", "HEAD"]);
    const r = runHook(root, [`refs/heads/master ${head} refs/heads/master ${head}`], {
      CLAUDECODE: "1",
    });
    assert.equal(r.status, 0, `Claude Code sessions must pass: ${describe(r)}`);
  });
});

test("does not block a branch merely NAMED like master", () => {
  withFixture((root) => {
    const head = git(root, ["rev-parse", "HEAD"]);
    for (const ref of ["refs/heads/master-fix", "refs/heads/feature/master", "refs/heads/mainline"]) {
      const r = runHook(root, [`${ref} ${head} ${ref} ${head}`]);
      assert.equal(r.status, 0, `${ref} is not master: ${describe(r)}`);
    }
  });
});

test("catches master when it is the SECOND of two ref lines", () => {
  withFixture((root) => {
    const head = git(root, ["rev-parse", "HEAD"]);
    const r = runHook(root, [
      `refs/heads/feature/x ${head} refs/heads/feature/x ${head}`,
      `refs/heads/master ${head} refs/heads/master ${head}`,
    ]);
    // The loop must not stop deciding after the first line.
    assert.equal(r.status, 1, `master on a later line must still block: ${describe(r)}`);
  });
});

// ── Deletion and empty input ────────────────────────────────────────────────

test("permits a branch DELETION push", () => {
  withFixture((root) => {
    const head = git(root, ["rev-parse", "HEAD"]);
    // `git push origin --delete branch` sends an all-zero LOCAL sha. Nothing is
    // being pushed, so there is nothing to scan. Before the fix this was
    // rejected as an "auth isolation violation": the zero sha reached
    // secret-scan.sh, which correctly refused to resolve it and exited 2, and
    // the loop counted that refusal as a violation.
    const r = runHook(root, [`refs/heads/f/x ${ZERO} refs/heads/f/x ${head}`]);
    assert.equal(r.status, 0, `a deletion pushes no content: ${describe(r)}`);
  });
});

test("permits a tag DELETION push", () => {
  withFixture((root) => {
    const head = git(root, ["rev-parse", "HEAD"]);
    const r = runHook(root, [`refs/tags/v1 ${ZERO} refs/tags/v1 ${head}`]);
    assert.equal(r.status, 0, `tag deletion pushes no content: ${describe(r)}`);
  });
});

test("permits a mixed push where one ref is a deletion and the other is real", () => {
  withFixture((root) => {
    const head = git(root, ["rev-parse", "HEAD"]);
    const tip = commitFile(root, "src/ok.ts", "export const a = 1;\n");
    const r = runHook(root, [
      `refs/heads/gone ${ZERO} refs/heads/gone ${head}`,
      `refs/heads/f/y ${tip} refs/heads/f/y ${head}`,
    ]);
    assert.equal(r.status, 0, `the deletion must not poison the real ref: ${describe(r)}`);
  });
});

test("permits empty stdin", () => {
  withFixture((root) => {
    // A here-string yields one iteration even for empty input, so both loops
    // must no-op on all-empty fields rather than scanning a bogus range.
    const r = runHook(root, "");
    assert.equal(r.status, 0, `no refs means nothing to check: ${describe(r)}`);
  });
});

// ── GUARD 2: secret scan ───────────────────────────────────────────────────

test("blocks a push whose range adds a credential", () => {
  withFixture((root) => {
    const base = git(root, ["rev-parse", "HEAD"]);
    const tip = commitFile(root, "deploy.ts", `${CREDENTIAL_LINE}\n`);
    const r = runHook(root, [`refs/heads/f/x ${tip} refs/heads/f/x ${base}`]);
    assert.equal(r.status, 1, `a new credential must block the push: ${describe(r)}`);
    assert.match(r.stdout + r.stderr, /Secret scan FAILED/);
  });
});

test("permits a push whose range adds no credential", () => {
  withFixture((root) => {
    const base = git(root, ["rev-parse", "HEAD"]);
    const tip = commitFile(root, "src/plain.ts", "export const b = 2;\n");
    const r = runHook(root, [`refs/heads/f/x ${tip} refs/heads/f/x ${base}`]);
    assert.equal(r.status, 0, `ordinary code must pass: ${describe(r)}`);
  });
});

// ── GUARD 3: auth isolation ────────────────────────────────────────────────

test("blocks a push that hardcodes a userId", () => {
  withFixture((root) => {
    const base = git(root, ["rev-parse", "HEAD"]);
    // The guard only inspects pages/api, lib, src/services and src/modules.
    const tip = commitFile(root, "pages/api/thing.ts", `${AUTH_VIOLATION_LINE}\n`);
    const r = runHook(root, [`refs/heads/f/x ${tip} refs/heads/f/x ${base}`]);
    assert.equal(r.status, 1, `hardcoded userId must block: ${describe(r)}`);
    assert.match(r.stdout, /AUTH ISOLATION VIOLATION/);
  });
});

test("permits a userId taken from the auth middleware", () => {
  withFixture((root) => {
    const base = git(root, ["rev-parse", "HEAD"]);
    const tip = commitFile(
      root,
      "pages/api/thing.ts",
      "const userId = (req as any).user?.id;\nexport default function h() { return userId; }\n",
    );
    const r = runHook(root, [`refs/heads/f/x ${tip} refs/heads/f/x ${base}`]);
    assert.equal(r.status, 0, `the correct pattern must pass: ${describe(r)}`);
  });
});
