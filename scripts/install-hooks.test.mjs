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
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
function createFixture(subdir = null) {
  const base = mkdtempSync(join(tmpdir(), "hookspath-"));
  // `subdir` lets a test put the repo at a path of its choosing — specifically
  // one containing a space, which broke worktree resolution.
  const root = subdir ? join(base, subdir) : base;
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

function withFixture(body, subdir = null) {
  const root = createFixture(subdir);
  // Remove the mkdtemp base, not just the repo, or a spaced-path fixture leaks.
  const cleanup = subdir ? dirname(root) : root;
  try {
    body(root);
  } finally {
    rmSync(cleanup, { recursive: true, force: true });
  }
}

function hooksPathOf(root) {
  const r = git(root, ["config", "--get", "core.hooksPath"]);
  return r.status === 0 ? r.stdout.trim() : null;
}

function describe(r) {
  return `exit=${r.status}\n${r.stdout}${r.stderr}`;
}

test("sets core.hooksPath and reads it back", () => {
  withFixture((root) => {
    const r = install(root);
    assert.equal(r.status, 0, describe(r));
    assert.equal(
      gitOk(root, ["config", "--get", "core.hooksPath"]),
      join(root, "scripts", "githooks"),
      "must be an ABSOLUTE path at the main worktree",
    );
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
      assert.equal(
      gitOk(root, ["config", "--get", "core.hooksPath"]),
      join(root, "scripts", "githooks"),
      "must be an ABSOLUTE path at the main worktree",
    );
    } finally {
      gitOk(root, ["worktree", "remove", "--force", wt]);
    }
  });
});

test("hooks fire from a worktree whose own branch LACKS scripts/githooks", () => {
  withFixture((root) => {
    // The gap that shipped: core.hooksPath is ONE value for the repo, but a
    // RELATIVE path resolves per checkout. A worktree on a branch predating the
    // hooks had no scripts/githooks, so git found nothing and SKIPPED the hooks
    // silently. Measured on the real machine: 42 of 43 worktrees affected.
    //
    // Every other test installs from a checkout that HAS the directory, which is
    // why none of them caught it.
    gitOk(root, ["branch", "no-hooks-branch", "HEAD"]);
    install(root);
    const wt = join(root, "..", `hookspath-nohooks-${process.pid}`);
    gitOk(root, ["worktree", "add", "--quiet", wt, "no-hooks-branch"]);
    try {
      // Make the worktree's own copy absent, as an older branch would be.
      rmSync(join(wt, "scripts", "githooks"), { recursive: true, force: true });
      writeFileSync(join(wt, "h.txt"), "z\n", "utf8");
      gitOk(wt, ["add", "h.txt"]);
      const c = git(wt, ["commit", "-m", "should still be blocked"]);
      assert.notEqual(c.status, 0, `hook must fire despite the local dir being absent: ${describe(c)}`);
      assert.match(c.stderr, /RAN-pre-commit/);
    } finally {
      gitOk(root, ["worktree", "remove", "--force", wt]);
    }
  });
});

test("refuses when the MAIN worktree lacks the hooks directory", () => {
  withFixture((root) => {
    // Setting an absolute path that does not exist would be worse than the
    // relative form: it disables the hooks EVERYWHERE rather than only in stale
    // worktrees. This is the state the real machine was in — main worktree
    // behind master, no scripts/githooks in it.
    rmSync(join(root, "scripts", "githooks"), { recursive: true, force: true });
    const r = install(root);
    assert.notEqual(r.status, 0, `must refuse: ${describe(r)}`);
    assert.match(r.stderr, /does not exist/);
    const cfg = git(root, ["config", "--get", "core.hooksPath"]);
    assert.notEqual(cfg.status, 0, "config must not be set to a missing path");
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

// ── Resolving which directory to anchor to ──────────────────────────────────
//
// Each of these was a live defect a reviewer reproduced, not a hypothetical.

test("resolves a repository path containing a SPACE", () => {
  withFixture((root) => {
    // `awk '/^worktree /{print $2; exit}'` splits on whitespace, so this path
    // resolved to everything before the space. The directory could then never
    // exist and the installer refused unconditionally with a wrong diagnosis
    // ("on a commit predating these hooks") on a checkout that was perfectly fine.
    assert.ok(root.includes(" "), "fixture must actually contain a space");
    const r = install(root);
    assert.equal(r.status, 0, `must install at a spaced path: ${describe(r)}`);
    assert.equal(hooksPathOf(root), join(root, "scripts", "githooks"));

    writeFileSync(join(root, "s.txt"), "x\n", "utf8");
    gitOk(root, ["add", "s.txt"]);
    const c = git(root, ["commit", "-m", "blocked"]);
    assert.notEqual(c.status, 0, `hook must fire at a spaced path: ${describe(c)}`);
    assert.match(c.stderr, /RAN-pre-commit/);
  }, "has space");
});

test("anchors to a real working tree in a BARE repo + worktrees layout", () => {
  withFixture((root) => {
    // `git worktree list --porcelain` reports a bare repo's own git-dir as the
    // first "worktree" entry. It has no checkout, so scripts/githooks can never
    // be there: the installer refused forever from every linked worktree, and
    // the remedy it printed (`git -C <git-dir> checkout master`) fails with
    // "this operation must be run in a work tree".
    const bare = join(dirname(root), "hub.git");
    const wt = join(dirname(root), "hub-wt");
    gitOk(root, ["clone", "--bare", "--quiet", root, bare]);
    gitOk(bare, ["worktree", "add", "--quiet", wt, "master"]);

    const r = install(wt);
    assert.equal(r.status, 0, `must resolve past the bare git-dir: ${describe(r)}`);
    const cfg = hooksPathOf(wt);
    assert.equal(cfg, join(wt, "scripts", "githooks"));
    assert.ok(!cfg.includes(".git/"), `must not anchor inside a git-dir: ${cfg}`);

    writeFileSync(join(wt, "b.txt"), "x\n", "utf8");
    gitOk(wt, ["add", "b.txt"]);
    const c = git(wt, ["commit", "-m", "blocked"]);
    assert.notEqual(c.status, 0, `hook must fire in the bare layout: ${describe(c)}`);
    assert.match(c.stderr, /RAN-pre-commit/);
  }, "src");
});

test("refuses when MAIN lacks the hooks but the CURRENT worktree has them", () => {
  withFixture((root) => {
    // The mutant this exists to kill: validate the CWD-relative directory rather
    // than the resolved absolute target. Every other test installs from a
    // checkout whose own copy is present, so the two paths agree and the bug is
    // invisible. Here they disagree — and validating the wrong one would set the
    // config to a directory that is not there, disabling hooks repo-wide.
    gitOk(root, ["branch", "wt-branch", "HEAD"]);
    const wt = join(dirname(root), `mainless-${process.pid}`);
    gitOk(root, ["worktree", "add", "--quiet", wt, "wt-branch"]);
    try {
      rmSync(join(root, "scripts", "githooks"), { recursive: true, force: true });
      assert.ok(existsSync(join(wt, "scripts", "githooks")), "worktree keeps its own copy");

      const r = install(wt);
      assert.notEqual(r.status, 0, `must refuse: ${describe(r)}`);
      assert.match(r.stderr, /does not exist/);
      assert.equal(hooksPathOf(wt), null, "must not set a path that is not there");
    } finally {
      gitOk(root, ["worktree", "remove", "--force", wt]);
    }
  });
});

test("falls back to this checkout when `git worktree` is unavailable", () => {
  withFixture((root) => {
    // The fallback for a git too old to have `worktree list`. Deleting the whole
    // block left every test green, so it was unverified code in a fail-closed path.
    const bin = mkdtempSync(join(tmpdir(), "gitshim-"));
    try {
      const shim = join(bin, "git");
      writeFileSync(
        shim,
        `#!/bin/bash\nif [ "$1" = "worktree" ]; then echo "fatal: unknown subcommand" >&2; exit 129; fi\nexec /usr/bin/git "$@"\n`,
        "utf8",
      );
      chmodSync(shim, 0o755);
      const r = spawnSync("bash", ["scripts/install-hooks.sh"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
      assert.equal(r.status, 0, `must fall back, not fail: ${describe(r)}`);
      assert.equal(hooksPathOf(root), join(root, "scripts", "githooks"));
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

// ── A reported failure must not leave config behind ─────────────────────────

test("leaves core.hooksPath UNSET when a hook is not executable", () => {
  withFixture((root) => {
    // The check ran AFTER the config write: the script printed the green
    // "core.hooksPath = ..." banner, then the red "not executable" line, exited
    // 1 — and left the config pointing at hooks git would silently skip. A
    // failure that still mutates config is the bug class this file guards.
    chmodSync(join(root, "scripts", "githooks", "pre-commit"), 0o644);
    const r = install(root);
    assert.notEqual(r.status, 0, `must fail: ${describe(r)}`);
    assert.equal(hooksPathOf(root), null, "a failed install must not set the config");
    assert.doesNotMatch(r.stdout, /✅/, "must not print success before failing");
  });
});

test("leaves core.hooksPath UNSET when the hooks directory is empty", () => {
  withFixture((root) => {
    // `[ -d ]` alone is satisfied by an empty directory — the hooks are what
    // matter, not the folder.
    for (const h of HOOKS) rmSync(join(root, "scripts", "githooks", h), { force: true });
    const r = install(root);
    assert.notEqual(r.status, 0, `must fail on an empty hooks dir: ${describe(r)}`);
    assert.equal(hooksPathOf(root), null, "a failed install must not set the config");
  });
});

// ── The git version gate ────────────────────────────────────────────────────
//
// Exercised through a `git` shim on PATH that reports a chosen version and
// delegates everything else to the real binary. Without these, deleting the
// entire gate left all tests green — one of the two silent-failure protections
// this script claims, undetected.

/** Put a `git` on PATH that reports `version` and delegates the rest. */
function withGitReporting(root, version, body) {
  const bin = mkdtempSync(join(tmpdir(), "gitshim-"));
  try {
    const shim = join(bin, "git");
    writeFileSync(
      shim,
      `#!/bin/bash\nif [ "$1" = "version" ]; then echo "${version}"; exit 0; fi\nexec /usr/bin/git "$@"\n`,
      "utf8",
    );
    chmodSync(shim, 0o755);
    body(
      spawnSync("bash", ["scripts/install-hooks.sh"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      }),
    );
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

test("refuses an UNPARSEABLE git version rather than failing open", () => {
  withFixture((root) => {
    // `sed` echoes its input unchanged on no-match, so the old parse produced
    // non-numeric values; `[ "$x" -lt 2 ]` then ERRORS rather than returning
    // false, `set -e` does not apply inside an `if` condition, and the script
    // fell through to a green banner with the config set. Measured.
    withGitReporting(root, "git version SOMETHING-WEIRD", (r) => {
      assert.notEqual(r.status, 0, `must refuse: ${describe(r)}`);
      assert.match(r.stderr, /Could not read a usable git version/);
      const cfg = git(root, ["config", "--get", "core.hooksPath"]);
      assert.notEqual(cfg.status, 0, "config must NOT have been set");
    });
  });
});

test("refuses a git older than 2.9, which ignores core.hooksPath entirely", () => {
  withFixture((root) => {
    withGitReporting(root, "git version 2.8.6", (r) => {
      assert.notEqual(r.status, 0, `must refuse: ${describe(r)}`);
      assert.match(r.stderr, /needs git >= 2\.9/);
    });
  });
});

test("refuses an all-digit but absurdly long version component", () => {
  withFixture((root) => {
    // Digits-only was not enough: a value too large for `[ -lt ]` errors with
    // the SAME message as a non-numeric one, down the same unguarded path, to
    // the same fail-open outcome. My own probe used 13 digits, which fits in an
    // int64 and compared fine — so it reported this hole as closed. The values
    // below straddle that: 13 digits is comparable, 32 is not, and both are
    // nonsense as versions, so both must refuse.
    for (const v of [
      "git version 99999999999999999999999999999999.0.0",
      "git version 9999999999999.1.0",
      "git version 2.99999999999999999999",
      // 6 and 8 digits: just past the bound, and nowhere near where bash's
      // comparison actually breaks. Without one of these the suite only pinned
      // "somewhere <= 12" — relaxing the bound from 5 to 12 left all 16 green,
      // so the constant the code documents was not actually tested.
      "git version 2.999999",
      "git version 99999999.0.0",
    ]) {
      git(root, ["config", "--unset", "core.hooksPath"]);
      withGitReporting(root, v, (r) => {
        assert.notEqual(r.status, 0, `must refuse ${v}: ${describe(r)}`);
        const cfg = git(root, ["config", "--get", "core.hooksPath"]);
        assert.notEqual(cfg.status, 0, `config must not be set for ${v}`);
      });
    }
  });
});

test("a second consecutive install is quiet, not a false 'already set' warning", () => {
  withFixture((root) => {
    // Re-running after a pull is a normal, documented case. Dropping the
    // equality check from the prior-value comparison left all tests green while
    // nagging on every ordinary re-run, because nothing installed twice.
    const first = install(root);
    assert.equal(first.status, 0, describe(first));
    const second = install(root);
    assert.equal(second.status, 0, describe(second));
    assert.doesNotMatch(
      second.stdout,
      /already set/,
      "re-running with the same value must not report a replacement",
    );
  });
});

test("accepts the version strings real gits actually print", () => {
  withFixture((root) => {
    for (const v of [
      "git version 2.9.0",
      "git version 2.39.5 (Apple Git-154)",
      "git version 2.9.0-rc1",
      "git version 3.0.0",
      "git version 2.34.1.1.g5c96eae0d",
      "git version 2.43.0.windows.1",
    ]) {
      git(root, ["config", "--unset", "core.hooksPath"]);
      withGitReporting(root, v, (r) => {
        assert.equal(r.status, 0, `${v} must be accepted: ${describe(r)}`);
      });
    }
  });
});

// ── Conflicts it must not resolve silently ──────────────────────────────────

test("reports an existing core.hooksPath it is about to replace", () => {
  withFixture((root) => {
    // Overwriting this silently is the same class of loss as clobbering a file,
    // and a higher-signal conflict than a leftover copy.
    gitOk(root, ["config", "core.hooksPath", "my/personal/hooks"]);
    const r = install(root);
    assert.equal(r.status, 0, describe(r));
    assert.match(r.stdout, /already set/);
    assert.match(r.stdout, /my\/personal\/hooks/, "must name what it replaced");
  });
});

test("reports a leftover hook of a type this repo does NOT ship", () => {
  withFixture((root) => {
    // core.hooksPath redirects git for EVERY hook type, so a developer's own
    // commit-msg stops firing the moment this runs. The notice must name it —
    // it is the one nobody else knows about.
    const own = join(root, ".git", "hooks", "commit-msg");
    writeFileSync(own, "#!/bin/bash\nexit 1\n", "utf8");
    chmodSync(own, 0o755);
    const r = install(root);
    assert.equal(r.status, 0, describe(r));
    assert.match(r.stdout, /commit-msg/, "the developer's own hook must be named");
    assert.match(r.stdout, /does NOT ship/, "and flagged as theirs, not ours");
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

test("mentions a leftover EXECUTABLE hook without deleting it", () => {
  withFixture((root) => {
    // A previously-copied hook may be the only copy of a local guard. It no
    // longer runs, but deleting it would be the very loss this replaced.
    const stale = join(root, ".git", "hooks", "pre-push");
    writeFileSync(stale, "#!/bin/bash\n# OLD_LOCAL_GUARD\nexit 0\n", "utf8");
    chmodSync(stale, 0o755);
    const r = install(root);
    assert.equal(r.status, 0, describe(r));
    assert.match(r.stdout, /none of them run/, "must point out the stale file");
    assert.match(
      spawnSync("cat", [stale], { encoding: "utf8" }).stdout,
      /OLD_LOCAL_GUARD/,
      "must NOT delete it",
    );
  });
});

test("does NOT mention a NON-executable leftover", () => {
  withFixture((root) => {
    const stale = join(root, ".git", "hooks", "pre-push");
    writeFileSync(stale, "#!/bin/bash\n# NEVER_RAN_ANYWAY\nexit 0\n", "utf8");
    chmodSync(stale, 0o644);
    const r = install(root);
    assert.equal(r.status, 0, describe(r));
    // git already ignored it, so no behaviour is being lost. Reporting it would
    // be noise, and noise trains people to skim the notice that matters.
    assert.doesNotMatch(r.stdout, /hooks remain/);
  });
});
