#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import chalk from 'chalk';

console.log(chalk.blue.bold('\n🔍 Checking for direct database connections...\n'));

const srcFiles = await glob('src/**/*.{ts,tsx,js,jsx}', {
  ignore: [
    'src/lib/**',
    'src/api/**',
    '**/node_modules/**',
    'src/tests/**'
  ]
});

const dbPatterns = [
  /import\s*{\s*sql\s*}\s*from\s*['"]@\/lib\/neon['"]/,
  /import\s*.*\s*from\s*['"]@\/lib\/neon['"]/,
  /createNeonClient/,
  /neon\(/,
  /\.query\(/,
  /\.execute\(/,
  /BEGIN;/,
  /COMMIT;/,
  /ROLLBACK;/
];

let totalViolations = 0;
const fileViolations = [];

srcFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  const violations = [];

  lines.forEach((line, index) => {
    for (const pattern of dbPatterns) {
      if (pattern.test(line)) {
        violations.push({
          line: index + 1,
          content: line.trim(),
          pattern: pattern.toString()
        });
      }
    }
  });

  if (violations.length > 0) {
    totalViolations += violations.length;
    fileViolations.push({ file, violations });
  }
});

if (totalViolations === 0) {
  console.log(chalk.green.bold('✅ No direct database connections found in frontend code!\n'));
  process.exit(0);
} else {
  console.log(chalk.red.bold(`❌ Found ${totalViolations} direct database connections in ${fileViolations.length} files:\n`));
  
  fileViolations.forEach(({ file, violations }) => {
    console.log(chalk.yellow(`\n📄 ${file}:`));
    violations.forEach(({ line, content }) => {
      console.log(chalk.gray(`   Line ${line}: `) + chalk.red(content));
    });
  });

  console.log(chalk.red.bold(`\n❌ Total violations: ${totalViolations}\n`));
  console.log(chalk.yellow('💡 Tip: Move database logic to API routes in the /api directory\n'));
  
  process.exit(1);
}