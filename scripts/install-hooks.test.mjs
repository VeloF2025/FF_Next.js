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
