#!/usr/bin/env node
//
// check-ci-baselines.mjs — fail the build when a CI ratchet baseline is
// declared somewhere that disagrees with scripts/ci-baselines.env.
//
// These numbers were duplicated across five files and no two agreed (see the
// header of ci-baselines.env). Deduplicating them once does not keep them
// deduplicated: the next person to touch a gate copies the literal again. This
// check is what makes the single source of truth actually single.
//
// Two kinds of declaration are recognised:
//   1. shell/markdown assignment   MAX_LINT_WARNINGS=186
//   2. the ESLint flag             --max-warnings 186   (or --max-warnings=186)
//
// A literal is allowed as long as it AGREES with the canonical value. Files
// that cannot source the env file at runtime — notably
// scripts/deploy-local-main.sh, which deploy-local.sh materialises from
// origin/master into a cache directory with no repo beside it — keep their
// literals and are held in agreement by this check instead.
//
// Usage:
//   node scripts/check-ci-baselines.mjs          # check, exit 1 on drift
//   node scripts/check-ci-baselines.mjs --list   # print canonical values
//
// Env:
//   CI_BASELINES_ROOT   repo root to scan (defaults to this script's parent)

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.CI_BASELINES_ROOT ?? join(HERE, ".."));
const ENV_REL = join("scripts", "ci-baselines.env");
const ENV_PATH = join(ROOT, ENV_REL);

// Literals here are historical records or disabled config, not live gates.
const IGNORED_PREFIXES = [
  join(".claude", "handoffs") + sep,
  join(".github", "workflows-disabled") + sep,
  join("docs", "archive") + sep,
  join("docs", "superpowers", "plans") + sep,
];

// The ratchet-bearing gates. Each must source the canonical file rather than
// re-inline the numbers, and each is additionally checked for `--max-warnings`
// literals.
//
// The flag check is scoped to these files on purpose: `--max-warnings 0` is a
// legitimate STRICTER policy elsewhere (package.json's `lint:strict`,
// zero-tolerance-check.cjs on changed files) and must not be dragged to the
// ratchet value. Only in a ratchet gate does the flag mean "the baseline".
const MUST_SOURCE = [
  join("scripts", "ci-local.sh"),
  join("scripts", "local-ci.sh"),
  join(".github", "workflows", "ci.yml"),
];

const FLAG_TO_KEY = { "--max-warnings": "MAX_LINT_WARNINGS" };

/** Parse `NAME=123` lines out of the canonical env file. */
export function parseBaselines(text) {
  const values = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(\d+)\s*$/.exec(line);
    if (match) values[match[1]] = Number(match[2]);
  }
  return values;
}

/**
 * Find every baseline declaration in `text`.
 *
 * The assignment form (`MAX_LINT_WARNINGS=186`) is unambiguous and is always
 * checked. The `--max-warnings` flag form is only checked when
 * `includeFlagForm` is set, i.e. inside a ratchet-bearing gate — see
 * MUST_SOURCE for why.
 *
 * Returns [{ line, key, value, form }].
 */
export function findDeclarations(text, canonicalKeys, { includeFlagForm = false } = {}) {
  const found = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    for (const key of canonicalKeys) {
      // Assignment form. Require a non-word char (or start) before the name so
      // MAX_LINT_ERRORS never matches inside e.g. FOO_MAX_LINT_ERRORS.
      const assign = new RegExp(`(?:^|[^A-Z0-9_])${key}=(\\d+)`, "g");
      let m;
      while ((m = assign.exec(line)) !== null) {
        found.push({ line: i + 1, key, value: Number(m[1]), form: `${key}=${m[1]}` });
      }
    }

    if (!includeFlagForm) continue;

    for (const [flag, key] of Object.entries(FLAG_TO_KEY)) {
      if (!canonicalKeys.includes(key)) continue;
      const flagRe = new RegExp(`${flag}[ =]+(\\d+)`, "g");
      let m;
      while ((m = flagRe.exec(line)) !== null) {
        found.push({ line: i + 1, key, value: Number(m[1]), form: `${flag} ${m[1]}` });
      }
    }
  }

  return found;
}

function trackedFiles(root) {
  const result = spawnSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ls-files failed in ${root}: ${result.stderr?.trim() || result.error?.message || "unknown error"}`,
    );
  }
  return result.stdout.split("\0").filter(Boolean);
}

function isIgnored(relPath) {
  if (relPath === ENV_REL) return true;
  return IGNORED_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

function readTextFile(absPath) {
  const stats = statSync(absPath, { throwIfNoEntry: false });
  // Skip anything large enough to be an asset rather than source.
  if (!stats || !stats.isFile() || stats.size > 2 * 1024 * 1024) return null;
  const buffer = readFileSync(absPath);
  if (buffer.includes(0)) return null; // binary
  return buffer.toString("utf8");
}

export function run({ root = ROOT, log = console.log, error = console.error } = {}) {
  const envPath = join(root, ENV_REL);
  if (!existsSync(envPath)) {
    error(`✗ missing canonical baseline file: ${ENV_REL}`);
    return 1;
  }

  const canonical = parseBaselines(readFileSync(envPath, "utf8"));
  const keys = Object.keys(canonical);
  if (keys.length === 0) {
    error(`✗ ${ENV_REL} declares no baselines`);
    return 1;
  }

  const problems = [];

  for (const relPath of trackedFiles(root)) {
    if (isIgnored(relPath)) continue;
    const text = readTextFile(join(root, relPath));
    if (text === null) continue;

    const includeFlagForm = MUST_SOURCE.includes(relPath);
    for (const decl of findDeclarations(text, keys, { includeFlagForm })) {
      if (decl.value !== canonical[decl.key]) {
        problems.push({
          file: relPath,
          line: decl.line,
          key: decl.key,
          found: decl.value,
          expected: canonical[decl.key],
          form: decl.form,
        });
      }
    }
  }

  for (const relPath of MUST_SOURCE) {
    const absPath = join(root, relPath);
    if (!existsSync(absPath)) continue;
    const text = readFileSync(absPath, "utf8");
    if (!text.includes("ci-baselines.env")) {
      problems.push({
        file: relPath,
        line: 0,
        key: "(structure)",
        found: "no reference to ci-baselines.env",
        expected: "must source scripts/ci-baselines.env",
        form: "source",
      });
    }
  }

  if (problems.length > 0) {
    error(`\n✗ CI baseline drift — ${problems.length} declaration(s) disagree with ${ENV_REL}\n`);
    for (const p of problems) {
      const where = p.line > 0 ? `${p.file}:${p.line}` : p.file;
      error(`  ${where}`);
      error(`    ${p.key}: found ${p.found}, canonical is ${p.expected}   (${p.form})`);
    }
    error(`\n  Canonical values live in ${ENV_REL}. Change them there, not here.`);
    error(`  If a gate genuinely needs a different threshold, it needs its own name.\n`);
    return 1;
  }

  const summary = keys.map((k) => `${k}=${canonical[k]}`).join("  ");
  log(`✓ CI baselines consistent — ${summary}`);
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  if (process.argv.includes("--list")) {
    const canonical = parseBaselines(readFileSync(ENV_PATH, "utf8"));
    for (const [key, value] of Object.entries(canonical)) console.log(`${key}=${value}`);
    process.exit(0);
  }
  process.exit(run());
}
