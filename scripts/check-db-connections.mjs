#!/usr/bin/env node
/**
 * check-db-connections.mjs
 *
 * Detects direct Neon database connections instantiated outside of
 * src/lib/ and pages/api/. Service files should use the shared connection
 * pool from src/lib/neon.ts — not create their own.
 *
 * WHAT WE FLAG:
 *   - neon(...)  called directly in service/module files
 *   - createNeonClient(...) called outside the lib layer
 *
 * WHAT WE DON'T FLAG (false positives removed):
 *   - import { sql } from '@/lib/neon'  — correct usage of abstraction
 *   - db.query() / db.execute()         — legitimate use of pool objects
 *   - BEGIN/COMMIT/ROLLBACK             — valid in transaction wrappers
 *   - pages/api/**                      — API routes are allowed DB access
 *   - src/lib/**                        — the abstraction layer itself
 *
 * Exit 0 = clean. Exit 1 = violations found (blocks CI).
 */

import fs from 'fs';
import { glob } from 'glob';
import chalk from 'chalk';

console.log(chalk.blue.bold('\n🔍 Checking for direct database connections...\n'));

const srcFiles = await glob('{src,pages}/**/*.{ts,tsx,js,jsx}', {
  ignore: [
    // These paths are ALLOWED to have DB access
    'src/lib/**',          // abstraction layer
    'src/api/**',          // legacy api dir
    'pages/api/**',        // Next.js API routes — allowed
    // Test / config noise
    '**/node_modules/**',
    'src/tests/**',
    '**/*.test.{ts,tsx}',
    '**/*.spec.{ts,tsx}',
    '**/__tests__/**',
  ]
});

/**
 * GENUINE VIOLATIONS: direct Neon connection instantiation outside the lib layer.
 *
 * Pattern rationale:
 *   neon(          - raw Neon HTTP driver call creating a new connection
 *   createNeonClient - legacy helper that also bypasses the shared pool
 *
 * We intentionally exclude:
 *   - import lines referencing neon (import { sql } from '@/lib/neon' is fine)
 *   - Comments
 *   - .query() / .execute() — too broad; matches service abstractions
 */
const VIOLATION_PATTERNS = [
  {
    pattern: /(?<!\/\/.*)\bneon\s*\(/,
    description: 'Direct neon() instantiation (bypasses shared pool)',
    // Exclude the lib itself and lines that are just imports/type refs
    exclude: /^\s*(import|export|\/\/|\/\*|\*)/,
  },
  {
    pattern: /\bcreateNeonClient\s*\(/,
    description: 'createNeonClient() — use shared sql from @/lib/neon instead',
    exclude: /^\s*(\/\/|\/\*|\*)/,
  },
];

let totalViolations = 0;
const fileViolations = [];

for (const file of srcFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  const violations = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    // Skip blank lines and comments
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    for (const { pattern, description, exclude } of VIOLATION_PATTERNS) {
      if (pattern.test(line)) {
        // Apply per-pattern exclusion filter
        if (exclude && exclude.test(trimmed)) continue;
        violations.push({
          line: index + 1,
          content: trimmed,
          description,
        });
      }
    }
  });

  if (violations.length > 0) {
    totalViolations += violations.length;
    fileViolations.push({ file, violations });
  }
}

if (totalViolations === 0) {
  console.log(chalk.green.bold('✅ No direct database connections found outside the API/lib layer!\n'));
  process.exit(0);
}

// ── Report violations ─────────────────────────────────────────────────────────
console.log(chalk.red.bold(
  `❌ Found ${totalViolations} direct DB connection(s) in ${fileViolations.length} file(s):\n`
));

fileViolations.forEach(({ file, violations }) => {
  console.log(chalk.yellow(`\n📄 ${file}:`));
  violations.forEach(({ line, content, description }) => {
    console.log(chalk.gray(`   Line ${line}: `) + chalk.red(content));
    console.log(chalk.gray(`          → ${description}`));
  });
});

console.log(chalk.red.bold(`\n❌ Total violations: ${totalViolations}\n`));
console.log(chalk.yellow(
  '💡 Fix: Use the shared sql instance from @/lib/neon (already initialised with the pool).\n' +
  '        Move DB logic to a pages/api/ route if it belongs in the service layer.\n'
));

process.exit(1);
