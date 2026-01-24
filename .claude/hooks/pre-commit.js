#!/usr/bin/env node

/**
 * FibreFlow Pre-Commit Hook
 *
 * Runs validation before git commits:
 * - TypeScript type checking
 * - ESLint validation
 * - Zero Tolerance checks (no console.log)
 *
 * BLOCKS commit if critical validation fails
 */

const { execSync } = require('child_process');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function runCommand(command, description) {
  log(`\n  Checking: ${description}...`, 'cyan');
  try {
    execSync(command, { encoding: 'utf-8', stdio: 'pipe', cwd: process.cwd() });
    log(`  ✓ ${description} passed`, 'green');
    return true;
  } catch (error) {
    log(`  ✗ ${description} failed`, 'red');
    if (error && error.stdout) {
      const output = error.stdout;
      if (output) {
        const lines = output.split('\n').slice(0, 20);
        lines.forEach(line => log(`    ${line}`, 'yellow'));
        if (output.split('\n').length > 20) {
          log(`    ... (${output.split('\n').length - 20} more lines)`, 'yellow');
        }
      }
    }
    return false;
  }
}

function hook() {
  log('\n╔════════════════════════════════════════════════════════════╗', 'cyan');
  log('║  FibreFlow Pre-Commit Validation                           ║', 'cyan');
  log('╚════════════════════════════════════════════════════════════╝', 'cyan');

  const checks = [
    { command: 'npm run type-check', description: 'TypeScript types' },
    { command: 'npm run lint', description: 'ESLint rules' },
  ];

  let allPassed = true;

  for (const check of checks) {
    if (!runCommand(check.command, check.description)) {
      allPassed = false;
    }
  }

  // Check for console.log in staged files
  log('\n  Checking: Zero Tolerance (console.log)...', 'cyan');
  try {
    const stagedFiles = execSync('git diff --cached --name-only --diff-filter=ACM', {
      encoding: 'utf-8',
      cwd: process.cwd(),
    }).trim();

    if (stagedFiles) {
      const tsFiles = stagedFiles.split('\n').filter(f =>
        (f.endsWith('.ts') || f.endsWith('.tsx')) &&
        !f.includes('node_modules') &&
        !f.includes('.test.') &&
        !f.includes('.spec.')
      );

      for (const file of tsFiles) {
        try {
          const content = execSync(`git show :${file}`, { encoding: 'utf-8' });
          const lines = content.split('\n');
          const consoleLines = lines
            .map((line, idx) => ({ line, num: idx + 1 }))
            .filter(({ line }) => /console\.(log|error|warn|info|debug)/.test(line))
            .filter(({ line }) => !line.trim().startsWith('//'));

          if (consoleLines.length > 0) {
            log(`  ✗ console.* found in ${file}:`, 'red');
            consoleLines.forEach(({ line, num }) => {
              log(`    Line ${num}: ${line.trim().substring(0, 60)}`, 'yellow');
            });
            allPassed = false;
          }
        } catch {
          // File might not be readable, skip
        }
      }
    }

    if (allPassed) {
      log('  ✓ Zero Tolerance passed', 'green');
    }
  } catch {
    log('  ⚠ Could not check staged files', 'yellow');
  }

  if (allPassed) {
    log('\n╔════════════════════════════════════════════════════════════╗', 'green');
    log('║  ✓ All validations passed - commit approved               ║', 'green');
    log('╚════════════════════════════════════════════════════════════╝\n', 'green');
  } else {
    log('\n╔════════════════════════════════════════════════════════════╗', 'red');
    log('║  ✗ COMMIT BLOCKED - Validation failed                     ║', 'red');
    log('╚════════════════════════════════════════════════════════════╝', 'red');
    log('\nFix the errors above before committing.', 'red');
    log('Quick fixes:', 'yellow');
    log('  • npm run lint -- --fix     (auto-fix lint issues)', 'yellow');
    log('  • npm run type-check        (see all type errors)', 'yellow');
    log('  • Replace console.* with log from @/lib/logger\n', 'yellow');

    throw new Error('FibreFlow validation failed - commit blocked');
  }
}

// Run the hook
hook();

module.exports = hook;
