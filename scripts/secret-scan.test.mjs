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

// Detection-surface fixtures (#2431). Every value below is invented.
//
// The URI form is the one that matters: issue #1830 — the leak this scanner
// exists to prevent — was a Postgres connection URI, and CLAUDE.md documents
// that exact `psql "postgresql://…"` shape. Before this change every rule
// required a credential keyword adjacent to an `=`, and a URI has neither.
const URI_CREDENTIAL = ["postgresql://ff_user:", "Kx9mQ2vTn7Lp", "@100.96.0.1:5437/fibreflow"].join("");
const URI_REDIS = ["redis://default:", "Rt4bVn8kLm2q", "@cache.internal:6379"].join("");
// Shapes the URI rule missed on its first attempt, each measured as CLEAN then.
const URI_SHORT_PW = ["postgresql://ff_user:", "Ax9zK", "@100.96.0.1:5437/fibreflow"].join("");
const URI_IPV6 = ["redis://svc:", "Rt4bVn8kLm2q", "@[2001:db8::1]:6379"].join("");
const URI_SLASH_PW = ["postgresql://ff_user:", "Xk9mQ2vT/Lp7Zn3", "@100.96.0.1:5437/db"].join("");
const URI_TEST_USER = ["postgresql://test-user:", "Kx9mQ2vTn7LpReal", "@100.96.0.1:5437/prod"].join("");
const URI_SCHEME_RELATIVE = ["//ff_user:", "Kx9mQ2vTn7LpReal", "@cdn.corp.net/lib.js"].join("");
const URI_ADMIN_PW = ["postgresql://ff_user:", "admin", "@100.96.0.1:5437/fibreflow"].join("");
// A real value that merely starts with "test-". The PLACEHOLDER filter is
// applied to the whole matched span, which includes the VALUE, so any secret
// prefixed this way whitelisted itself.
const TEST_PREFIXED = ["SESSION_SEC", 'RET="test-', "a1b2c3d4e5f6a7b8c9d0", '"'].join("");

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

// ── Detection surface (#2431) ────────────────────────────────────────────────
// Enforcement was hardened in #2425 — the gate runs and fails closed. These
// cover what it actually RECOGNISES, which was narrower than the green check
// implied.

test("flags a credential embedded in a connection URI", () => {
  withFixture({}, (root) => {
    commitFile(root, "runbook.md", `psql "${URI_CREDENTIAL}"\n`);
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 1, `URI credential must be caught — this is the #1830 shape: ${describe(r)}`);
    assert.match(r.stdout, /URI/i);
  });
});

test("flags a credential in a non-postgres URI scheme", () => {
  withFixture({}, (root) => {
    commitFile(root, "compose.yml", `  REDIS_URL: ${URI_REDIS}\n`);
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 1, `any scheme://user:pass@host is a credential: ${describe(r)}`);
  });
});

test("does not flag a URI with no credential, or a placeholder one", () => {
  withFixture({}, (root) => {
    commitFile(
      root,
      "docs.md",
      [
        "postgresql://localhost:5437/fibreflow",
        "postgresql://user:pass@host:5437/db",
        "postgresql://ff_user:${PGPASSWORD}@host:5437/db",
        "https://app.fibreflow.app/storage/",
        "postgresql://ff_user:<your-password>@host:5437/db",
        "",
      ].join("\n"),
    );
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 0, `documented placeholder URIs must stay clean: ${describe(r)}`);
  });
});

test("flags a URI credential with a short password", () => {
  withFixture({}, (root) => {
    // A length floor was measured letting a real 5-character credential through.
    // A short password is still a password; placeholder forms are excluded by
    // NAME instead, because placeholder words are enumerable and lengths are not.
    commitFile(root, "deploy.md", `DATABASE_URL=${URI_SHORT_PW}\n`);
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 1, `a short password is still a credential: ${describe(r)}`);
  });
});

test("flags a URI credential on an IPv6 host", () => {
  withFixture({}, (root) => {
    // `[` was absent from the host class, so every IPv6-host URI was missed.
    commitFile(root, "compose.yml", `  REDIS_URL: ${URI_IPV6}\n`);
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 1, `IPv6 authority must be recognised: ${describe(r)}`);
  });
});

test("flags a URI credential whose password contains a slash", () => {
  withFixture({}, (root) => {
    // `/` was excluded from the password class, which broke the `:`→`@` run and
    // dropped the whole credential regardless of its strength.
    commitFile(root, "runbook.md", `psql "${URI_SLASH_PW}"\n`);
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 1, `a slash in the password must not hide it: ${describe(r)}`);
  });
});

test("flags a scheme-relative authority carrying a credential", () => {
  withFixture({}, (root) => {
    // `//user:pass@host` with no scheme token, the HTML src/href form. Requiring
    // a literal scheme contradicted the rule's own stated intent.
    commitFile(root, "page.html", `<script src="${URI_SCHEME_RELATIVE}"></script>\n`);
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 1, `a missing scheme is not a missing credential: ${describe(r)}`);
  });
});

test("flags a URI whose password is the literal word admin", () => {
  withFixture({}, (root) => {
    // "admin" is a real default credential, not a documentation placeholder, so
    // it does not belong in the placeholder exclusion list.
    commitFile(root, "runbook.md", `psql "${URI_ADMIN_PW}"\n`);
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 1, `a weak real password is still a password: ${describe(r)}`);
  });
});

test("flags a URI credential whose USERNAME starts with test-", () => {
  withFixture({}, (root) => {
    // The global placeholder list carries a `test[-_]…[:=]` term, and a URI's
    // own mandatory `username:password` colon satisfied it — so this was exempt
    // no matter how real the password was.
    commitFile(root, "runbook.md", `psql "${URI_TEST_USER}"\n`);
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 1, `a test-prefixed username must not exempt the password: ${describe(r)}`);
  });
});

test("colon rule does not fire on prose values that merely follow a credential key", () => {
  withFixture({}, (root) => {
    // Both measured in this repo before the digit requirement. An error map and
    // a schema example are ordinary things to add in a PR, and the gate blocks
    // the PR — so a false positive here is not cosmetic.
    commitFile(
      root,
      "errors.ts",
      [
        "const ERRORS = {",
        "  'auth/wrong-password': 'Incorrect password.',",
        "};",
        'const schema = { "password": "string" };',
        "",
      ].join("\n"),
    );
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 0, `prose after a credential key is not a credential: ${describe(r)}`);
  });
});

test("colon rule does not fire on an identifier that merely ends in a keyword", () => {
  withFixture({}, (root) => {
    // `minipass` is a real npm package and appears 29 times across
    // package-lock.json and bun.lock in this repo. Without a boundary before
    // the keyword, every lockfile update would trip the gate.
    commitFile(
      root,
      "package-lock.json",
      [
        '{ "packages": {',
        '  "node_modules/minipass": { "version": "7.0.4" },',
        '  "node_modules/fs-minipass": { "minipass": "^7.0.4" }',
        "} }",
        "",
      ].join("\n"),
    );
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 0, `a package named *pass is not a credential: ${describe(r)}`);
  });
});

test("does not flag the shapes that made the colon and lowercase rules unusable", () => {
  withFixture({}, (root) => {
    // A colon rule and a lowercase env rule were attempted here and removed. All
    // four lines below were measured tripping them, and a false positive BLOCKS
    // an unrelated PR — a loud, expensive failure, unlike a missed pattern.
    //
    // The colon rule could not be made safe in diff mode: the scanner has no
    // file-type information, so it cannot tell an auth fixture's
    // `password: '<value>'` from the same line in production config. Its digit
    // safeguard was also measured firing on the rule's own boundary character
    // rather than on the value.
    //
    // Pinned so a future attempt has to clear these before landing.
    commitFile(
      root,
      "assorted.ts",
      [
        "const testUser = { email: 'a@b.com', password: 'Passw0rd1' };",
        '  "csrf-token": "^2.1.0",',
        '1Password: "vaultitemlink"',
        "cache_token=deterministic_hash_no_real_secret",
        "",
      ].join("\n"),
    );
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 0, `none of these is a credential: ${describe(r)}`);
  });
});

test("a value merely prefixed 'test-' does not whitelist itself", () => {
  withFixture({}, (root) => {
    commitFile(root, "config.ts", `${TEST_PREFIXED}\n`);
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 1, `the placeholder filter must not read the VALUE: ${describe(r)}`);
  });
});

test("a genuinely test-scoped KEY is still exempt", () => {
  withFixture({}, (root) => {
    // The key names the fixture, not the value — this is the case the
    // placeholder term exists for and must keep working.
    commitFile(root, "helper.ts", "const TEST_PASSWORD = process.env.TEST_PASSWORD;\n");
    const r = runScan(root, ["--branch"]);
    assert.equal(r.status, 0, `env-var reference must stay clean: ${describe(r)}`);
  });
});

test("an unknown mode is an error, not a pass", () => {
  withFixture({}, (root) => {
    const r = runScan(root, ["--everything"]);
    assert.notEqual(r.status, 0, `unknown mode must not pass: ${describe(r)}`);
  });
});
