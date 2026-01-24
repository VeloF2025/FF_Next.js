#!/usr/bin/env node
/**
 * Staging Fix Logger Hook
 *
 * Automatically detects and logs staging fixes to the issue log.
 * Runs after Bash commands that interact with staging server.
 *
 * Detection patterns:
 * - Database password fixes (sed for npg_)
 * - Systemd WorkingDirectory fixes
 * - Git reset operations
 * - Permission fixes (chown)
 * - Service restarts after errors
 */

const fs = require('fs');
const path = require('path');

const SKILL_FILE = path.join(__dirname, '../skills/staging-deploy.md');
const LOG_FILE = path.join(__dirname, '../memories/staging-fixes.json');

// Get environment variables from Claude hooks
const toolInput = process.env.TOOL_INPUT || '';
const toolOutput = process.env.TOOL_OUTPUT || '';

// Detection patterns for staging fixes
const FIX_PATTERNS = [
  {
    pattern: /sed.*npg_[a-zA-Z0-9]+.*npg_[a-zA-Z0-9]+.*\.env\.production/,
    issue: 'Database authentication failed',
    rootCause: 'Wrong DB password in `.env.production`',
    fixApplied: 'Updated DATABASE_URL password via sed'
  },
  {
    pattern: /sed.*WorkingDirectory.*fibreflow/,
    issue: '404 on all routes',
    rootCause: 'Wrong `WorkingDirectory` in systemd service',
    fixApplied: 'Corrected systemd WorkingDirectory path'
  },
  {
    pattern: /git reset --hard origin\/master/,
    issue: 'Stale/diverged git branch',
    rootCause: 'Staging on old commit with outdated code',
    fixApplied: 'Reset to origin/master'
  },
  {
    pattern: /chown.*louis.*\.git/,
    issue: 'Git permission denied',
    rootCause: 'Mixed file ownership in .git directory',
    fixApplied: 'Fixed .git ownership to louis'
  },
  {
    pattern: /systemctl daemon-reload/,
    issue: 'Systemd config changed',
    rootCause: 'Service file was modified',
    fixApplied: 'Reloaded systemd daemon'
  },
  {
    pattern: /git checkout -- \./,
    issue: 'Local changes blocking checkout',
    rootCause: 'Uncommitted changes on staging',
    fixApplied: 'Discarded local changes'
  }
];

// Check if this is a staging-related command
function isStagingCommand(input) {
  return input.includes('100.96.203.105') ||
         input.includes('vf.fibreflow') ||
         input.includes('/home/louis/apps/fibreflow') ||
         input.includes('fibreflow.service');
}

// Detect which fix was applied
function detectFix(input) {
  if (!isStagingCommand(input)) return null;

  for (const pattern of FIX_PATTERNS) {
    if (pattern.pattern.test(input)) {
      return {
        date: new Date().toISOString().split('T')[0],
        issue: pattern.issue,
        rootCause: pattern.rootCause,
        fixApplied: pattern.fixApplied,
        command: input.substring(0, 100) + (input.length > 100 ? '...' : '')
      };
    }
  }
  return null;
}

// Load existing fixes
function loadFixes() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
    }
  } catch (e) {
    // Ignore errors, start fresh
  }
  return [];
}

// Save fix to JSON log
function saveFix(fix) {
  const fixes = loadFixes();

  // Avoid duplicates (same issue on same day)
  const isDuplicate = fixes.some(f =>
    f.date === fix.date && f.issue === fix.issue
  );

  if (!isDuplicate) {
    fixes.push(fix);
    fs.writeFileSync(LOG_FILE, JSON.stringify(fixes, null, 2));

    // Also append to the skill's issue log
    appendToSkillLog(fix);
  }
}

// Append to the staging-deploy.md issue log table
function appendToSkillLog(fix) {
  try {
    let content = fs.readFileSync(SKILL_FILE, 'utf-8');

    // Find the issue log table
    const tableMarker = '**Add new issues here as they\'re discovered and fixed.**';
    const insertPoint = content.indexOf(tableMarker);

    if (insertPoint > 0) {
      // Find the last table row before the marker
      const beforeMarker = content.substring(0, insertPoint);
      const lastPipeIndex = beforeMarker.lastIndexOf('|');
      const insertPosition = content.lastIndexOf('\n', lastPipeIndex) + 1;

      // Create new table row
      const newRow = `| ${fix.date} | ${fix.issue} | ${fix.rootCause} | ${fix.fixApplied} |\n`;

      // Check if this row already exists
      if (!content.includes(newRow.trim())) {
        content = content.substring(0, insertPosition) + newRow + content.substring(insertPosition);
        fs.writeFileSync(SKILL_FILE, content);
        console.log(`[staging-fix-logger] Logged: ${fix.issue}`);
      }
    }
  } catch (e) {
    // Silently fail - don't break the workflow
  }
}

// Main execution
const fix = detectFix(toolInput);
if (fix) {
  saveFix(fix);
}
