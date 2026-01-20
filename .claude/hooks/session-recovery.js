#!/usr/bin/env node
/**
 * Session Recovery Hook
 *
 * Triggered on SessionStart to check for previous session state
 * and provide recovery information to Claude.
 *
 * Usage in settings.json:
 * {
 *   "hooks": {
 *     "SessionStart": ["node .claude/hooks/session-recovery.js"]
 *   }
 * }
 */

const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '..', 'session', 'current.json');
const HISTORY_DIR = path.join(__dirname, '..', 'session', 'history');

function formatTimestamp(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString('en-ZA', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function getTimeSince(isoString) {
  const then = new Date(isoString);
  const now = new Date();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays} day(s) ago`;
  if (diffHours > 0) return `${diffHours} hour(s) ago`;
  if (diffMins > 0) return `${diffMins} minute(s) ago`;
  return 'just now';
}

function main() {
  // Check if session file exists
  if (!fs.existsSync(SESSION_FILE)) {
    console.log('No previous session found. Starting fresh.');
    return;
  }

  try {
    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));

    // Build recovery message
    const lines = [
      '',
      '╔══════════════════════════════════════════════════════════════╗',
      '║                   SESSION RECOVERY AVAILABLE                  ║',
      '╠══════════════════════════════════════════════════════════════╣',
    ];

    // Last session info
    if (session.last_updated) {
      lines.push(`║ Last active: ${formatTimestamp(session.last_updated).padEnd(42)}║`);
      lines.push(`║ Time since:  ${getTimeSince(session.last_updated).padEnd(42)}║`);
    }

    // Current task
    if (session.working_on) {
      lines.push('╠══════════════════════════════════════════════════════════════╣');
      lines.push('║ LAST TASK:                                                   ║');
      const task = session.working_on.task || 'Unknown';
      lines.push(`║   ${task.substring(0, 54).padEnd(54)}║`);

      if (session.working_on.status) {
        lines.push(`║   Status: ${session.working_on.status.padEnd(47)}║`);
      }

      if (session.working_on.last_action) {
        lines.push('║                                                              ║');
        lines.push('║ LAST ACTION:                                                 ║');
        const action = session.working_on.last_action.substring(0, 54);
        lines.push(`║   ${action.padEnd(54)}║`);
      }
    }

    // Progress checkpoints
    if (session.working_on?.progress?.length > 0) {
      lines.push('╠══════════════════════════════════════════════════════════════╣');
      lines.push('║ PROGRESS:                                                    ║');
      session.working_on.progress.slice(-5).forEach(item => {
        const trimmed = item.substring(0, 56);
        lines.push(`║   ${trimmed.padEnd(54)}║`);
      });
    }

    // Pending tasks
    if (session.pending_tasks?.length > 0) {
      lines.push('╠══════════════════════════════════════════════════════════════╣');
      lines.push('║ PENDING TASKS:                                               ║');
      session.pending_tasks.slice(0, 3).forEach(task => {
        const desc = typeof task === 'string' ? task : task.description;
        const trimmed = desc.substring(0, 54);
        lines.push(`║   • ${trimmed.padEnd(52)}║`);
      });
      if (session.pending_tasks.length > 3) {
        lines.push(`║   ... and ${(session.pending_tasks.length - 3)} more`.padEnd(59) + '║');
      }
    }

    // Files modified
    if (session.working_on?.files_modified?.length > 0) {
      lines.push('╠══════════════════════════════════════════════════════════════╣');
      lines.push('║ FILES MODIFIED:                                              ║');
      session.working_on.files_modified.slice(0, 3).forEach(file => {
        const trimmed = file.substring(0, 54);
        lines.push(`║   ${trimmed.padEnd(54)}║`);
      });
    }

    // Previous session summary
    if (session.previous_session?.summary) {
      lines.push('╠══════════════════════════════════════════════════════════════╣');
      lines.push('║ PREVIOUS SESSION:                                            ║');
      const summary = session.previous_session.summary.substring(0, 54);
      lines.push(`║   ${summary.padEnd(54)}║`);
    }

    lines.push('╠══════════════════════════════════════════════════════════════╣');
    lines.push('║ To continue where you left off, say "continue" or "resume"   ║');
    lines.push('║ To start fresh, say "new session" or just describe your task ║');
    lines.push('╚══════════════════════════════════════════════════════════════╝');
    lines.push('');

    console.log(lines.join('\n'));

  } catch (error) {
    console.error('Error reading session file:', error.message);
  }
}

main();
