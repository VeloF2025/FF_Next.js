#!/usr/bin/env node
//
// silent-catch-ratchet.mjs — score `no-silent-catch` across src/ and pages/
// against the per-scope baselines in scripts/ci-baselines.env.
//
// Why this script exists (2026-08-22)
// -----------------------------------
// `local/no-silent-catch` is declared in .eslintrc.json, which is DEAD CONFIG:
// .eslintrc.cjs wins ESLint 8 precedence and declares neither the `local`
// plugin nor the rule, so `npx eslint --print-config` resolves with no `local/*`
// rules at all. The only thing that has ever run this rule is Gate 2's explicit
// `--rulesdir` invocation, and that invocation scans `pages/api` alone.
//
// Measured on this branch's clean tree: pages/api 77, the rest of pages/ 174,
// src/ 1192. So ~93% of the codebase's silent catches sat outside any gate,
// including all of src/ — which CLAUDE.md's zero-tolerance "no empty catch
// blocks" rule nominally covers.
//
// Three scopes, not one total
// ---------------------------
// Same reasoning as MAX_PAGES_LINT_WARNINGS in ci-baselines.env: a combined
// number makes debt fungible, so paying down 50 src catches would silently buy
// headroom for 50 new API-route ones. pages/api keeps MAX_SILENT_CATCHES and its
// eight-step provenance log untouched; the two new scopes ratchet separately.
//
// One ESLint pass
// ---------------
// Gate 2 used to shell out to `npx eslint pages/api` and grep the human output.
// Widening that shape would mean three eslint startups (~35s each on src alone).
// This runs the Node API once over both trees and buckets the results by path,
// which is also how it can assert per-scope that files were actually linted.
//
// Fail-loud, never silently clean
// -------------------------------
// The defect this replaces was a gate that reported a clean pass having scanned
// nothing (ESLint exits 2 before linting on a bad --rulesdir or a moved path,
// and the old `|| true` swallowed it). Counting is not enough: a scope that
// linted ZERO files also counts zero. So each scope asserts a non-zero linted
// file count, and any throw is a failure rather than a zero.
//
// Usage:
//   node scripts/silent-catch-ratchet.mjs           # score, exit 1 on regression
//   node scripts/silent-catch-ratchet.mjs --list    # print measured counts only
//
// Exit codes: 0 clean · 1 regression · 2 the check itself could not run.

import { ESLint } from "eslint";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(HERE, ".."));
const RULE_ID = "no-silent-catch";

// Bare rule id via rulePaths, mirroring how ci-local.sh Gate 2c and
// scripts/verify-no-direct-status-writes.ts load their rules. The "local/"
// prefix is deliberately NOT used: node_modules/eslint-plugin-local is a
// hand-vendored shim that `npm ci` overwrites with the real v6 package, so the
// prefix is not dependable in CI. --rulesdir reads scripts/eslint-rules/
// directly and survives a clean install.
const RULES_DIR = join(ROOT, "scripts", "eslint-rules");

// [baseline key, label, predicate on the repo-relative path]. Order matters:
// pages/api must be tested before the general pages/ bucket.
const SCOPES = [
  ["MAX_SILENT_CATCHES", "pages/api", (p) => p.startsWith(`pages${sep}api${sep}`)],
  ["MAX_PAGES_OTHER_SILENT_CATCHES", "pages (non-api)", (p) => p.startsWith(`pages${sep}`)],
  ["MAX_SRC_SILENT_CATCHES", "src", (p) => p.startsWith(`src${sep}`)],
];

function parseBaselines() {
  const text = readFileSync(join(ROOT, "scripts", "ci-baselines.env"), "utf8");
  const values = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Z][A-Z0-9_]*)=(\d+)\s*$/.exec(line);
    if (m) values[m[1]] = Number(m[2]);
  }
  return values;
}

function bucketFor(relPath) {
  for (const scope of SCOPES) if (scope[2](relPath)) return scope[0];
  return null;
}

async function main() {
  const baselines = parseBaselines();
  for (const [key] of SCOPES) {
    if (!Number.isInteger(baselines[key])) {
      // Mirrors ci-local.sh's `: "${MAX_SILENT_CATCHES:?...}"` guard. An absent
      // baseline must abort, not compare against NaN and fall through as clean.
      console.error(`[FAIL] ${key} is not set by scripts/ci-baselines.env`);
      process.exit(2);
    }
  }

  const eslint = new ESLint({
    cwd: ROOT,
    useEslintrc: true, // .eslintrc.cjs — the TS parser and ignore patterns
    rulePaths: [RULES_DIR],
    overrideConfig: { rules: { [RULE_ID]: "error" } },
    errorOnUnmatchedPattern: true, // a moved target path fails instead of scanning nothing
  });

  const results = await eslint.lintFiles([
    "src/**/*.{ts,tsx}",
    "pages/**/*.{ts,tsx}",
  ]);

  const counts = {};
  const linted = {};
  const samples = {};
  for (const [key] of SCOPES) {
    counts[key] = 0;
    linted[key] = 0;
    samples[key] = [];
  }

  for (const result of results) {
    const rel = relative(ROOT, result.filePath);
    const key = bucketFor(rel);
    if (!key) continue;
    linted[key] += 1;
    for (const msg of result.messages) {
      if (msg.ruleId !== RULE_ID) continue;
      counts[key] += 1;
      if (samples[key].length < 5) samples[key].push(`${rel}:${msg.line}  ${msg.message}`);
    }
  }

  if (process.argv.includes("--list")) {
    for (const [key, label] of SCOPES) {
      console.log(`${label}: ${counts[key]} (${linted[key]} files linted) [${key}=${baselines[key]}]`);
    }
    return 0;
  }

  let failed = false;
  for (const [key, label] of SCOPES) {
    if (linted[key] === 0) {
      // A scope that linted nothing reports zero findings, which is
      // indistinguishable from a clean scope by count alone.
      console.error(`[FAIL] ${label}: 0 files linted — the gate scanned nothing`);
      failed = true;
      continue;
    }
    if (counts[key] <= baselines[key]) {
      console.log(`[OK  ] ${label}: ${counts[key]} silent catches (≤${baselines[key]}, ${linted[key]} files)`);
    } else {
      console.error(
        `[FAIL] ${label}: ${counts[key]} silent catches (max ${baselines[key]}) — new silent catch block(s) added`,
      );
      for (const s of samples[key]) console.error(`         ${s}`);
      failed = true;
    }
  }
  return failed ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // Any throw here means the scan did not complete. Exit 2 so a caller can
    // tell "could not run" apart from "found regressions".
    console.error(`[FAIL] silent-catch ratchet could not run: ${err && err.message}`);
    console.error(err && err.stack);
    process.exit(2);
  });
