#!/usr/bin/env node
// Tests for scripts/install-hooks.sh — which now points git at the tracked
// hooks via core.hooksPath instead of copying them into .git/hooks.
//
// The copy-based design needed eleven tests and still had holes, because every
// failure mode lived in the copy: clobbering a diverged hook, colliding backup
// names, symlinks, permissions, ownership, repo shapes. None of that exists now.
// What remains worth testing is narrow and all of it is about NOT reporting
// success when the hooks would not actually run:
//
//   - the config is set, and reads back as the intended value
//   - a hook missing its exec bit is reported, because git skips one SILENTLY
//   - the hooks genuinely fire, from the main checkout and from a worktree
//   - it refuses outside a repo, and when the hooks directory is absent

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER = resolve(HERE, "install-hooks.sh");
const HOOKS = ["pre-commit", "pre-push"];

function git(root, args, env = {}) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function gitOk(root, args) {
  const r = git(root, args);
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * A throwaway repo with the installer and stub hooks that announce themselves,
 * so a test can prove the hook actually RAN rather than that a file exists.
 */
function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "hookspath-"));
  mkdirSync(join(root, "scripts", "githooks"), { recursive: true });
  copyFileSync(INSTALLER, join(root, "scripts", "install-hooks.sh"));
  for (const h of HOOKS) {
    const p = join(root, "scripts", "githooks", h);
    // Exit 1 so the test can detect the hook ran by the operation being blocked.
    writeFileSync(p, `#!/bin/bash\necho "RAN-${h}" >&2\nexit 1\n`, "utf8");
    chmodSync(p, 0o755);
  }
  writeFileSync(join(root, "README.md"), "fixture\n", "utf8");
  gitOk(root, ["init", "--quiet"]);
  gitOk(root, ["config", "user.email", "ci@example.com"]);
  gitOk(root, ["config", "user.name", "ci"]);
  gitOk(root, ["add", "-A"]);
  // --no-verify: the baseline commit must not be blocked by the stub hooks.
  gitOk(root, ["commit", "--quiet", "--no-verify", "-m", "baseline"]);
  return root;
}

function install(root, cwd = root) {
  return spawnSync("bash", ["scripts/install-hooks.sh"], { cwd, encoding: "utf8" });
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

test("sets core.hooksPath and reads it back", () => {
  withFixture((root) => {
    const r = install(root);
    assert.equal(r.status, 0, describe(r));
    assert.equal(gitOk(root, ["config", "--get", "core.hooksPath"]), "scripts/githooks");
  });
});

test("the pre-commit hook actually runs after install", () => {
  withFixture((root) => {
    install(root);
    writeFileSync(join(root, "f.txt"), "x\n", "utf8");
    gitOk(root, ["add", "f.txt"]);
    // The stub exits 1, so a blocked commit is proof the hook executed —
    // stronger than asserting a file exists somewhere.
    const c = git(root, ["commit", "-m", "should be blocked"]);
    assert.notEqual(c.status, 0, `the hook must block the commit: ${describe(c)}`);
    assert.match(c.stderr, /RAN-pre-commit/, "the hook must have executed");
  });
});

test("the hooks run from a WORKTREE too (shared config)", () => {
  withFixture((root) => {
    install(root);
    const wt = join(root, "..", `hookspath-wt-${process.pid}`);
    gitOk(root, ["worktree", "add", "--quiet", wt, "-b", "wt-branch"]);
    try {
      writeFileSync(join(wt, "g.txt"), "y\n", "utf8");
      gitOk(wt, ["add", "g.txt"]);
      const c = git(wt, ["commit", "-m", "should be blocked"]);
      assert.notEqual(c.status, 0, `the hook must block from a worktree: ${describe(c)}`);
      assert.match(c.stderr, /RAN-pre-commit/);
    } finally {
      gitOk(root, ["worktree", "remove", "--force", wt]);
    }
  });
});

test("installing FROM a worktree configures the shared repo", () => {
  withFixture((root) => {
    const wt = join(root, "..", `hookspath-wtinst-${process.pid}`);
    gitOk(root, ["worktree", "add", "--quiet", wt, "-b", "wt-inst"]);
    try {
      const r = install(root, wt);
      assert.equal(r.status, 0, describe(r));
      assert.equal(gitOk(root, ["config", "--get", "core.hooksPath"]), "scripts/githooks");
    } finally {
      gitOk(root, ["worktree", "remove", "--force", wt]);
    }
  });
});

test("reports a hook that is not executable instead of claiming success", () => {
  withFixture((root) => {
    // Git SKIPS a non-executable hook without a word, so a silent success here
    // would mean a security gate that never runs while the tool says it is on.
    chmodSync(join(root, "scripts", "githooks", "pre-push"), 0o644);
    const r = install(root);
    assert.notEqual(r.status, 0, `must fail: ${describe(r)}`);
    assert.match(r.stderr, /not executable/);
    assert.match(r.stderr, /pre-push/);
  });
});

test("refuses when the tracked hooks directory is missing", () => {
  withFixture((root) => {
    rmSync(join(root, "scripts", "githooks"), { recursive: true, force: true });
    const r = install(root);
    assert.notEqual(r.status, 0, `must fail: ${describe(r)}`);
    assert.match(r.stderr, /does not exist/);
  });
});

test("refuses outside a git repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "hookspath-norepo-"));
  try {
    mkdirSync(join(dir, "scripts", "githooks"), { recursive: true });
    copyFileSync(INSTALLER, join(dir, "scripts", "install-hooks.sh"));
    const r = spawnSync("bash", ["scripts/install-hooks.sh"], { cwd: dir, encoding: "utf8" });
    assert.notEqual(r.status, 0, `must refuse: ${describe(r)}`);
    assert.match(r.stderr, /Not inside a git repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mentions leftover files in .git/hooks without deleting them", () => {
  withFixture((root) => {
    // A previously-copied hook may be the only copy of a local guard. It no
    // longer runs, but deleting it would be the very loss this replaced.
    const stale = join(root, ".git", "hooks", "pre-push");
    writeFileSync(stale, "#!/bin/bash\n# OLD_LOCAL_GUARD\nexit 0\n", "utf8");
    const r = install(root);
    assert.equal(r.status, 0, describe(r));
    assert.match(r.stdout, /no longer used/, "must point out the stale file");
    assert.match(
      spawnSync("cat", [stale], { encoding: "utf8" }).stdout,
      /OLD_LOCAL_GUARD/,
      "must NOT delete it",
    );
  });
});
