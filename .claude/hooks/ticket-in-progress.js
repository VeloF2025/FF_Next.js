#!/usr/bin/env node
/**
 * ticket-in-progress.js — PostToolUse hook
 *
 * Fires after a Bash tool call that creates a worktree or branch.
 * Extracts the VF-YYYYMMDD-NNN ticket UID from the branch name and
 * SSHes to Velocity to mark the ticket `in_progress` in the DB.
 *
 * Trigger commands:
 *   git worktree add <path> [-b <branch>] [...]
 *   git checkout -b <branch>
 *   git switch -c <branch>
 */

'use strict';

const { execFileSync } = require('child_process');

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET  = '\x1b[0m';

// Strict validation: only digits, uppercase letters, hyphens — no injection possible
const TICKET_UID_RE = /\bvf-(\d{8}-\d+)\b/i;

function extractTicketUid(command) {
  const match = command.match(TICKET_UID_RE);
  if (!match) return null;
  return `VF-${match[1]}`;
}

function isBranchCreationCommand(command) {
  return (
    /git\s+worktree\s+add/.test(command) ||
    /git\s+checkout\s+-b/.test(command) ||
    /git\s+switch\s+-c/.test(command)
  );
}

function markInProgress(ticketUid) {
  // ticketUid is validated by TICKET_UID_RE to contain only digits and hyphens
  // after the VF- prefix (e.g. VF-20260430-001). Use psql -v for defence-in-depth.
  const remoteCmd = [
    `PGURL=$(grep '^DATABASE_URL=' /home/velo/fibreflow-dev/.env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')`,
    `[ -n "$PGURL" ] || exit 0`,
    `psql "$PGURL" -t -q -v "uid=${ticketUid}" -c "UPDATE maintenance_tickets SET status='in_progress', updated_at=NOW() WHERE ticket_uid=:'uid' AND status='assigned' RETURNING ticket_uid" 2>/dev/null`,
  ].join(' && ');

  try {
    const result = execFileSync('ssh', [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=5',
      '-o', 'BatchMode=yes',
      'velo@100.96.203.105',
      remoteCmd,
    ], { encoding: 'utf-8', timeout: 10000 });

    if (result.trim()) {
      console.log(`${GREEN}[ticket] ${ticketUid} → in_progress${RESET}`);
    } else {
      console.log(`${YELLOW}[ticket] ${ticketUid} — already past assigned or not found${RESET}`);
    }
  } catch {
    // SSH failure or Velocity unreachable — never block the developer workflow
    console.log(`${YELLOW}[ticket] Could not reach Velocity to update ${ticketUid} (non-fatal)${RESET}`);
  }
}

function main() {
  let toolInput;
  try {
    toolInput = JSON.parse(process.env.TOOL_INPUT || '{}');
  } catch {
    return;
  }

  const command = toolInput.command || '';
  if (!isBranchCreationCommand(command)) return;

  const ticketUid = extractTicketUid(command);
  if (!ticketUid) return;

  markInProgress(ticketUid);
}

main();
