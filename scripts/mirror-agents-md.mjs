#!/usr/bin/env node
/**
 * Mirror the Claude-facing docs into Codex-facing `AGENTS.md` siblings.
 * Plain ESM — runs on bare `node`, no tsx / TypeScript / dependencies.
 *
 *   node scripts/mirror-agents-md.mjs             # write
 *   node scripts/mirror-agents-md.mjs --dry-run   # preview
 *   node scripts/mirror-agents-md.mjs --check     # exit 1 if STALE or MISSING
 *
 * `--check` compares rendered content to disk rather than using `git diff`:
 * git cannot see an untracked file, so a diff-based gate passes silently when a
 * sibling that SHOULD exist was never committed at all.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/** Codex's default combined project-instruction limit is 32 KiB. */
const CODEX_LIMIT_BYTES = 32 * 1024;
const WARN_BYTES = 28 * 1024;

/** N-rule: don't port a stub, or a doc for a module too small to need one. */
const MIN_SOURCE_FILES = 4;
const MIN_DOC_LINES = 10;

/**
 * This repository keeps all nested `.claude.md` beside source under `src/`.
 * Scanning from the root would wander into docs, fixtures, and vendored code.
 */
const SCAN_ROOTS = ["src"];

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|rs|java|kt|php)$/;
const SKIP_DIRS = new Set(["node_modules", ".next"]);

function listClaudeMd(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) listClaudeMd(full, acc);
    else if (entry.name === ".claude.md") acc.push(full);
  }
  return acc;
}

/**
 * Modules in this repo normally keep implementation in component/service
 * subdirectories rather than beside `.claude.md`, so the source count must be
 * recursive. Tests intentionally count: adding them can make a subtree large
 * enough to need path-scoped guidance.
 */
function countSourceFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) n += countSourceFiles(full);
    else if (entry.isFile() && SOURCE_EXT.test(entry.name)) n++;
  }
  return n;
}

function banner(canonical) {
  return [
    `<!-- GENERATED — do not edit. Canonical source: ${canonical} -->`,
    `<!-- Regenerate: node scripts/mirror-agents-md.mjs -->`,
    `<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose`,
    `     below may refer to ".claude.md" when describing the canonical side;`,
    `     that is accurate — only PATH references are rewritten to AGENTS.md. -->`,
    ``,
  ].join("\n");
}

/**
 * Rewrite only backtick-quoted PATH references, because those name files Codex
 * would never open. Prose about the mirroring system remains unchanged.
 *
 * The `/` in the pattern is load-bearing. A blanket replacement also rewrites
 * prose ABOUT the transform and can turn its subject into a false tautology.
 */
function render(source, canonical) {
  const body = readFileSync(source, "utf8")
    .replace(/`([^`\s]*\/)\.claude\.md`/g, "`$1AGENTS.md`");
  return banner(canonical) + body;
}

function targets() {
  const emit = [{
    out: resolve(ROOT, "AGENTS.md"),
    source: resolve(ROOT, "CLAUDE.md"),
    canonical: "CLAUDE.md",
  }];
  const skipped = [];
  const nested = [];

  for (const scanRoot of SCAN_ROOTS) {
    listClaudeMd(resolve(ROOT, scanRoot), nested);
  }

  for (const doc of nested.sort()) {
    const dir = dirname(doc);
    const rel = relative(ROOT, doc);
    const files = countSourceFiles(dir);
    const lines = readFileSync(doc, "utf8").split("\n").length;
    if (files < MIN_SOURCE_FILES) {
      skipped.push(`${rel} — small-module (${files} source files)`);
      continue;
    }
    if (lines < MIN_DOC_LINES) {
      skipped.push(`${rel} — stub (${lines} lines)`);
      continue;
    }
    emit.push({
      out: resolve(dir, "AGENTS.md"),
      source: doc,
      canonical: "./.claude.md",
    });
  }
  return { emit, skipped };
}

function isWithin(child, parent) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

const argv = process.argv.slice(2);
const CHECK = argv.includes("--check");
const DRY = argv.includes("--dry-run");

if (!existsSync(resolve(ROOT, "CLAUDE.md"))) {
  console.error(
    "[agents] FAIL — no CLAUDE.md at the repo root. Write it first; mirroring an absent file helps nobody.",
  );
  process.exit(1);
}

const { emit, skipped } = targets();
const rendered = emit.map((target) => ({
  ...target,
  content: render(target.source, target.canonical),
}));

for (const target of rendered) {
  const targetDir = dirname(target.out);
  const chainBytes = rendered
    .filter((candidate) => isWithin(targetDir, dirname(candidate.out)))
    .reduce((sum, candidate) => sum + Buffer.byteLength(candidate.content, "utf8"), 0);
  const rel = relative(ROOT, target.out);

  if (chainBytes > CODEX_LIMIT_BYTES) {
    console.error(
      `[agents] FAIL — the instruction chain ending at ${rel} is ${(chainBytes / 1024).toFixed(1)} KB, over Codex's default 32 KiB limit.`,
    );
    process.exit(1);
  }
  if (chainBytes > WARN_BYTES) {
    console.warn(
      `[agents] warn — the instruction chain ending at ${rel} is ${(chainBytes / 1024).toFixed(1)} KB, approaching the default 32 KiB limit.`,
    );
  }
}

const stale = [];
const missing = [];
const written = [];

for (const target of rendered) {
  const rel = relative(ROOT, target.out);

  if (CHECK) {
    if (!existsSync(target.out)) missing.push(rel);
    else if (readFileSync(target.out, "utf8") !== target.content) stale.push(rel);
    continue;
  }

  // Only touch changed files so --dry-run and the printed count are truthful.
  if (
    existsSync(target.out)
    && readFileSync(target.out, "utf8") === target.content
  ) {
    continue;
  }
  if (!DRY) writeFileSync(target.out, target.content, "utf8");
  written.push(rel);
}

if (CHECK) {
  if (missing.length === 0 && stale.length === 0) {
    console.log(
      `[agents:check] OK — ${emit.length} AGENTS.md mirror(s) match their canonical source.`,
    );
    process.exit(0);
  }
  console.error("[agents:check] FAIL — AGENTS.md is out of sync with CLAUDE.md:\n");
  for (const item of missing) console.error(`  MISSING  ${item}`);
  for (const item of stale) console.error(`  STALE    ${item}`);
  console.error("\nFix: node scripts/mirror-agents-md.mjs");
  process.exit(1);
}

console.log(
  DRY
    ? `[agents] dry-run — ${written.length} file(s) would be written.`
    : `[agents] wrote ${written.length} file(s).`,
);
for (const item of written) console.log(`  ${item}`);
for (const item of skipped) console.log(`  [skip] ${item}`);
