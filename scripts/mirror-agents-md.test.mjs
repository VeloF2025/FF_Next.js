#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_SCRIPT = resolve(HERE, "mirror-agents-md.mjs");

function createFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "mirror-agents-md-"));
  const scripts = resolve(root, "scripts");
  const moduleDir = resolve(root, "src", "config");

  mkdirSync(scripts, { recursive: true });
  mkdirSync(moduleDir, { recursive: true });
  copyFileSync(SOURCE_SCRIPT, resolve(scripts, "mirror-agents-md.mjs"));
  writeFileSync(resolve(root, "CLAUDE.md"), "# Root instructions\n", "utf8");
  writeFileSync(
    resolve(moduleDir, ".claude.md"),
    Array.from({ length: 10 }, (_, index) => `Rule ${index + 1}`).join("\n"),
    "utf8",
  );
  for (let index = 1; index <= 4; index += 1) {
    writeFileSync(resolve(moduleDir, `source-${index}.ts`), "export {};\n", "utf8");
  }

  return root;
}

function runGenerator(root, ...args) {
  return spawnSync(
    process.execPath,
    [resolve(root, "scripts", "mirror-agents-md.mjs"), ...args],
    { cwd: root, encoding: "utf8" },
  );
}

test("--check distinguishes stale and missing mirrors", (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(runGenerator(root).status, 0);
  assert.equal(runGenerator(root, "--check").status, 0);

  appendFileSync(resolve(root, "CLAUDE.md"), "\nprobe\n", "utf8");
  const stale = runGenerator(root, "--check");
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /STALE\s+AGENTS\.md/);

  assert.equal(runGenerator(root).status, 0);
  unlinkSync(resolve(root, "src", "config", "AGENTS.md"));
  const missing = runGenerator(root, "--check");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /MISSING\s+src\/config\/AGENTS\.md/);
});

test("--check reports and write mode removes orphaned mirrors", (context) => {
  const root = createFixture();
  const mirror = resolve(root, "src", "config", "AGENTS.md");
  context.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(runGenerator(root).status, 0);
  unlinkSync(resolve(root, "src", "config", "source-4.ts"));

  const orphaned = runGenerator(root, "--check");
  assert.equal(orphaned.status, 1);
  assert.match(orphaned.stderr, /ORPHAN\s+src\/config\/AGENTS\.md/);

  assert.equal(runGenerator(root).status, 0);
  assert.equal(existsSync(mirror), false);
  assert.equal(runGenerator(root, "--check").status, 0);
});
