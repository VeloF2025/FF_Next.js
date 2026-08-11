#!/usr/bin/env node
// Tests for scripts/secret-scan.sh — the guard named in CLAUDE.md rule 11.
//
// The scanner had no tests until this file. That mattered once it became a
// blocking CI step: its failure mode is a false NEGATIVE (a real credential
// scored clean), which is invisible by construction. Every case below asserts
// on the exit status, because that is the only thing CI reads.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_SCRIPT = resolve(HERE, "secret-scan.sh");

// Every credential-like fixture is assembled from fragments at runtime. This
// file is scanned by the very scanner it tests, so spelling the literals out
// would make the gate fail on the PR that adds its own tests. Splitting the
// keyword from its value means no single line here matches a scanner rule.
const LEAKED_PG_LINE = ["PGPASS", "WORD='", "Zq7mKp2LvRt9Xn4", "'"].join("");
const BURNED_VALUE = ["zander", "2026"].join("");

const ZERO_SHA = "0".repeat(40);

function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * A throwaway git repo holding a copy of the scanner and one baseline commit.
 *
 * withOrigin: false omits refs/remotes/origin/master. That is exactly how a
 * runner that failed to fetch the base branch looks to the scanner, and it is
 * the case the CI gate depends on not silently passing.
 */
function createFixture({ withOrigin = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "secret-scan-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(SOURCE_SCRIPT, join(root, "scripts", "secret-scan.sh"));
  writeFileSync(join(root, "baseline.txt"), "no credentials here\n", "utf8");

  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "ci@example.com"]);
  git(root, ["config", "user.name", "ci"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "--quiet", "-m", "baseline"]);
  if (withOrigin) pointOriginAtHead(root);
  return root;
}

function pointOriginAtHead(root) {
  git(root, ["update-ref", "refs/remotes/origin/master", git(root, ["rev-parse", "HEAD"])]);
}

function commitFile(root, name, body) {
  writeFileSync(join(root, name), body, "utf8");
  git(root, ["add", "-A"]);
  git(root, ["commit", "--quiet", "-m", `add ${name}`]);
}

function runScan(root, args) {
  return spawnSync("bash", ["scripts/secret-scan.sh", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

function withFixture(options, body) {
  const root = createFixture(options);
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function describe(result) {
  return `exit=${result.status}\n${result.stdout}${result.stderr}`;
}

test("--branch flags a credential added since the merge-base", () => {
  withFixture({}, (root) => {
    commitFile(root, "deploy-notes.md", `then run ${LEAKED_PG_LINE} psql -h db\n`);
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 1, `expected a detection: ${describe(r)}`);
    assert.match(r.stdout, /hardcoded PGPASSWORD/);
    // The offending line's CONTENT is echoed, which is what makes a CI failure
    // actionable -- you can grep the repo for it. The file name is not: in the
    // diff modes the `<n>:` prefix is an offset into the concatenated added-line
    // blob, not a file:line. Only --tree reports real paths. Asserted here so
    // that limitation is recorded rather than rediscovered.
    assert.match(r.stdout, /Zq7mKp2LvRt9Xn4/);
    assert.doesNotMatch(r.stdout, /deploy-notes\.md/);
  });
});

test("--branch ignores a variable reference and a credentials.local pointer", () => {
  withFixture({}, (root) => {
    commitFile(
      root,
      "runbook.md",
      'PGPASSWORD="$PGPASSWORD" psql -h db   # see .claude/credentials.local.md\n',
    );
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 0, `documented placeholder form must stay clean: ${describe(r)}`);
  });
});

test("--branch never reports clean when origin/master cannot be resolved", () => {
  withFixture({ withOrigin: false }, (root) => {
    commitFile(root, "deploy-notes.md", `then run ${LEAKED_PG_LINE} psql -h db\n`);
    const r = runScan(root, ["--branch"]);
    // Fail CLOSED. A missing base means the scan covered nothing, and reporting
    // success there is the false negative that makes the whole gate a lie.
    assert.notEqual(r.status, 0, `unresolvable base must fail the build: ${describe(r)}`);
    assert.doesNotMatch(r.stdout, /Secret scan passed/);
  });
});

test("--branch scans a clean diff without tripping on pre-existing hits", () => {
  withFixture({}, (root) => {
    // The credential is already in the baseline, i.e. it predates the branch.
    // The scan is diff-based precisely so this does not block unrelated work.
    writeFileSync(join(root, "legacy.md"), `${LEAKED_PG_LINE}\n`, "utf8");
    git(root, ["add", "-A"]);
    git(root, ["commit", "--quiet", "-m", "pre-existing"]);
    pointOriginAtHead(root);
    commitFile(root, "feature.md", "an ordinary change\n");
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 0, `pre-existing content must not block: ${describe(r)}`);
  });
});

test("tree-wide denylist catches a burned value even when it is not in the diff", () => {
  withFixture({}, (root) => {
    commitFile(root, "old-doc.md", `the password was ${BURNED_VALUE}\n`);
    // Move the base forward so the added-lines scan cannot see it. Only the
    // tree-wide denylist can now, which is the point of having one.
    pointOriginAtHead(root);
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 1, `expected a denylist hit: ${describe(r)}`);
    assert.match(r.stdout, /previously-leaked value reintroduced/);
  });
});

test("--staged flags a credential sitting in the index", () => {
  withFixture({}, (root) => {
    writeFileSync(join(root, "config.sh"), `${LEAKED_PG_LINE}\n`, "utf8");
    git(root, ["add", "-A"]);
    const r = runScan(root, ["--staged"]);
    assert.equal(r.status, 1, `expected a detection: ${describe(r)}`);
  });
});

test("--range flags a credential in the pushed range", () => {
  withFixture({}, (root) => {
    const base = git(root, ["rev-parse", "HEAD"]);
    commitFile(root, "deploy-notes.md", `then run ${LEAKED_PG_LINE} psql -h db\n`);
    const r = runScan(root, ["--range", base, "HEAD"]);
    assert.equal(r.status, 1, `expected a detection: ${describe(r)}`);
  });
});

test("--range rejects a missing base instead of scanning nothing", () => {
  withFixture({}, (root) => {
    commitFile(root, "deploy-notes.md", `then run ${LEAKED_PG_LINE} psql -h db\n`);
    // The all-zero SHA is what GitHub sends as `before` on a branch's first
    // push. git cannot diff it, and the old code swallowed that to a clean pass.
    const r = runScan(root, ["--range", ZERO_SHA, "HEAD"]);
    assert.notEqual(r.status, 0, `unresolvable base must fail the build: ${describe(r)}`);
    assert.doesNotMatch(r.stdout, /Secret scan passed/);
  });
});

test("an unknown mode is an error, not a pass", () => {
  withFixture({}, (root) => {
    const r = runScan(root, ["--everything"]);
    assert.notEqual(r.status, 0, `unknown mode must not pass: ${describe(r)}`);
  });
});
