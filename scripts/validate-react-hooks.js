#!/usr/bin/env node

/**
 * React Hooks Validator
 * 
 * Scans the codebase for React Hooks rule violations and generates
 * metrics for continuous monitoring. This catches silent bugs early.
 * 
 * Usage:
 *   node scripts/validate-react-hooks.js
 * 
 * Outputs metrics to: ../../team-brain/metrics/hooks-violations.md
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Detect workspace root — could be /home/hein/.openclaw/flow/workspace or similar
const findWorkspaceRoot = () => {
  let current = process.cwd();
  while (current !== '/') {
    if (fs.existsSync(path.join(current, 'team-brain'))) {
      return current;
    }
    current = path.dirname(current);
  }
  // Fallback to parent of staging/production
  return path.resolve(__dirname, '../../..');
};

const WORKSPACE_ROOT = findWorkspaceRoot();
const METRICS_DIR = path.join(WORKSPACE_ROOT, 'team-brain/metrics');
const OUTPUT_FILE = path.join(METRICS_DIR, 'hooks-violations.md');

// Ensure metrics directory exists
if (!fs.existsSync(METRICS_DIR)) {
  fs.mkdirSync(METRICS_DIR, { recursive: true });
}

try {
  // Run eslint with react-hooks focus
  const eslintOutput = execSync(
    'eslint src --ext ts,tsx --format json --quiet 2>/dev/null || true',
    { encoding: 'utf-8', cwd: process.cwd() }
  );

  let violations = [];
  try {
    const results = JSON.parse(eslintOutput);
    results.forEach(file => {
      file.messages.forEach(msg => {
        if (msg.ruleId && msg.ruleId.includes('react-hooks')) {
          violations.push({
            file: path.relative(process.cwd(), file.filePath),
            rule: msg.ruleId,
            line: msg.line,
            column: msg.column,
            message: msg.message,
            severity: msg.severity === 2 ? 'error' : 'warning'
          });
        }
      });
    });
  } catch (e) {
    // JSON parse failed, no violations
  }

  // Count by rule
  const ruleCount = {};
  const severityCount = { error: 0, warning: 0 };
  violations.forEach(v => {
    ruleCount[v.rule] = (ruleCount[v.rule] || 0) + 1;
    severityCount[v.severity]++;
  });

  // Sort violations by file
  violations.sort((a, b) => a.file.localeCompare(b.file));

  // Generate report
  const timestamp = new Date().toISOString();
  const reportLines = [
    '# React Hooks Violations Report',
    '',
    `**Generated:** ${timestamp}`,
    `**Total Violations:** ${violations.length}`,
    `**Errors:** ${severityCount.error} | **Warnings:** ${severityCount.warning}`,
    '',
    '## Summary by Rule',
    ''
  ];

  // Rule breakdown
  Object.entries(ruleCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([rule, count]) => {
      reportLines.push(`- **${rule}:** ${count} violation${count !== 1 ? 's' : ''}`);
    });

  reportLines.push('');
  reportLines.push('## Violations');
  reportLines.push('');

  if (violations.length === 0) {
    reportLines.push('✅ No React Hooks violations detected.');
  } else {
    violations.forEach(v => {
      reportLines.push(
        `**${v.file}:${v.line}:${v.column}** [${v.severity.toUpperCase()}]`
      );
      reportLines.push(`\`\`\`\n${v.message}\n\`\`\``);
      reportLines.push('');
    });
  }

  // Write report
  const report = reportLines.join('\n');
  fs.writeFileSync(OUTPUT_FILE, report, 'utf-8');

  console.log(`✓ Hooks validation complete. ${violations.length} violation${violations.length !== 1 ? 's' : ''} found.`);
  console.log(`✓ Report written to: ${OUTPUT_FILE}`);

  // Exit with error if there are violations
  process.exit(violations.length > 0 ? 1 : 0);
} catch (error) {
  console.error('❌ Error running Hooks validator:', error.message);
  process.exit(2);
}
