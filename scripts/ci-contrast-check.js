#!/usr/bin/env node
/**
 * WCAG P10 — CI Contrast Check
 * Scans TSX/TS source files for known low-contrast Tailwind colour classes.
 * FibreFlow uses a dark theme (#0f172a base). Failing classes are those that
 * don't meet WCAG 2.1 AA 4.5:1 contrast ratio against the dark background.
 *
 * Known failures (dark theme):
 *   text-gray-500   ~3.9:1  ❌ FAILS
 *   text-slate-500  ~3.9:1  ❌ FAILS
 *   text-gray-600   ~2.1:1  ❌ FAILS
 *   text-slate-600  ~2.1:1  ❌ FAILS
 *   text-zinc-500   ~3.8:1  ❌ FAILS
 *   text-neutral-500 ~3.8:1 ❌ FAILS
 *
 * Passing alternatives (dark theme):
 *   text-gray-400   ~7.0:1  ✅
 *   text-slate-400  ~7.0:1  ✅
 *
 * Usage: node scripts/ci-contrast-check.js
 * Exit 0 = clean, Exit 1 = violations found
 *
 * Prepared by: Pixel 2026-02-23
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Classes that fail WCAG AA 4.5:1 on FibreFlow dark theme
const FAILING_CLASSES = [
  'text-gray-500',
  'text-slate-500',
  'text-gray-600',
  'text-slate-600',
  'text-zinc-500',
  'text-neutral-500',
  'text-gray-700',    // Very dark background variant
  'text-slate-700',
];

// File patterns to scan
const SCAN_DIRS = ['src', 'pages'];
const SCAN_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

// Directories/files to exclude
const EXCLUDE_PATTERNS = [
  'node_modules',
  '.next',
  'dist',
  'coverage',
  '__tests__',
  '.test.',
  '.spec.',
  'vitest.setup',
  'vitest.config',
  'scripts/',
  'skills/',
];

function shouldExclude(filePath) {
  return EXCLUDE_PATTERNS.some(pattern => filePath.includes(pattern));
}

function getFilesRecursively(dir, extensions) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (shouldExclude(fullPath)) continue;

    if (entry.isDirectory()) {
      files.push(...getFilesRecursively(fullPath, extensions));
    } else if (extensions.includes(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function scanFileForViolations(filePath, content) {
  const violations = [];
  const lines = content.split('\n');

  lines.forEach((line, lineIndex) => {
    // Skip comment lines
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

    FAILING_CLASSES.forEach(cls => {
      // Match class in className, clsx, cn, tw, or similar — not in comments
      // Pattern: the class appears as a word boundary within a string/template
      const regex = new RegExp(`\\b${cls.replace('-', '\\-')}\\b`);
      if (regex.test(line) && !line.includes(`// ok`) && !line.includes(`/* contrast-ok */`)) {
        violations.push({
          file: filePath,
          line: lineIndex + 1,
          text: trimmed.substring(0, 120),
          class: cls,
        });
      }
    });
  });

  return violations;
}

function main() {
  console.log('🔍 WCAG P10 — Contrast Check starting...\n');

  const allFiles = [];
  for (const dir of SCAN_DIRS) {
    allFiles.push(...getFilesRecursively(dir, SCAN_EXTENSIONS));
  }

  console.log(`   Scanning ${allFiles.length} source files for low-contrast Tailwind classes...\n`);

  const allViolations = [];
  for (const filePath of allFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const violations = scanFileForViolations(filePath, content);
    allViolations.push(...violations);
  }

  if (allViolations.length === 0) {
    console.log('✅ No contrast violations found — WCAG AA clear\n');
    process.exit(0);
  }

  // Group by file
  const byFile = {};
  allViolations.forEach(v => {
    if (!byFile[v.file]) byFile[v.file] = [];
    byFile[v.file].push(v);
  });

  console.log(`❌ Found ${allViolations.length} contrast violation(s) in ${Object.keys(byFile).length} file(s):\n`);

  Object.entries(byFile).forEach(([file, violations]) => {
    console.log(`  📄 ${file} (${violations.length} violation${violations.length > 1 ? 's' : ''})`);
    violations.forEach(v => {
      console.log(`     Line ${v.line}: [${v.class}] ${v.text}`);
    });
    console.log('');
  });

  console.log('Fix: Replace failing classes with WCAG AA compliant alternatives:');
  console.log('  text-gray-500 / text-slate-500 / text-gray-600 → text-gray-400 / text-slate-400');
  console.log('');
  console.log('To suppress a legitimate exception (rare), add: {/* contrast-ok */} comment on the same line.');
  console.log('See: skills/wcag-fix/SKILL.md for full guidance.');
  console.log('');

  process.exit(1);
}

main();
