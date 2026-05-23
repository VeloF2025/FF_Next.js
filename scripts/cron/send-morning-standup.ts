#!/usr/bin/env node
/**
 * Morning Standup Cron Job
 *
 * Sends a per-user morning digest of outstanding tickets, Mon-Fri at 08:00 SAST.
 * Each email only contains tickets relevant to that specific user:
 *   - "My Tickets"   : assigned_to === user
 *   - "Team Tickets" : assigned to a team the user belongs to, excluding their own
 *
 * Ticket sources aggregated:
 *   - NOC tickets           (`maintenance_tickets` table)
 *   - H&S audits            (`hs_project_audits` — open = in_progress / requires_action)
 *   - ManCo action items    (`manco_action_items` — matched by name, best-effort)
 *
 * Users with zero relevant tickets are skipped entirely (no empty emails).
 *
 * Usage:
 *   npx tsx scripts/cron/send-morning-standup.ts
 *   npx tsx scripts/cron/send-morning-standup.ts --only=zander@velocityfibre.com   # test: one recipient
 *   npx tsx scripts/cron/send-morning-standup.ts --dry-run                          # no emails sent
 *
 * VPS Cron Setup (08:00 SAST Mon-Fri):
 *   0 8 * * 1-5 cd /var/www/fibreflow && /usr/bin/npx tsx scripts/cron/send-morning-standup.ts >> /var/log/morning-standup-cron.log 2>&1
 */

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const ONLY_EMAIL = parseArg('only')?.toLowerCase();
const DRY_RUN = process.argv.includes('--dry-run');

import { Resend } from 'resend';
import {
  generateMorningStandupEmail,
  StandupTicket,
  StandupTicketSource,
} from '../../src/lib/email/templates/morningStandup';

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.production' });

// DB driver note: post-Neon-cutover (2026-04-18) the database is self-hosted
// Supabase. The @neondatabase/serverless `neon()` driver speaks Neon's HTTP
// protocol, which Supabase does not — and the webpack neon-shim that rescues
// the Next.js app does not apply to a standalone tsx script. So we use the
// shared pg.Pool via `@/lib/db-pool`, whose `sql` export is a tagged-template
// drop-in for neon's `sql`. It MUST be imported dynamically inside main()
// (after dotenv runs) because src/lib/db.ts builds the pool from
// process.env.DATABASE_URL at module load.

// This is a standalone tsx cron whose output is captured to a logfile
// (`>> /var/log/morning-standup-cron.log 2>&1`). The app logger
// (@/lib/logger) deliberately never writes to stdout/stderr — it only
// buffers in memory — so it would silence this job's operational trail.
// Write to stdout/stderr directly, matching the sibling crons
// attendance-cartrack-reconcile.ts and attendance-reconcile.ts.
const logOut = (msg: string) => process.stdout.write(msg + '\n');
const logErr = (msg: string) => process.stderr.write(msg + '\n');
const fmtErr = (e: unknown) =>
  e instanceof Error ? e.stack ?? e.message : JSON.stringify(e);

const DATABASE_URL = process.env.DATABASE_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app';
const FROM_ADDRESS =
  process.env.MORNING_STANDUP_FROM || 'FibreFlow Standup <standup@fibreflow.app>';

if (!DATABASE_URL) {
  logErr('DATABASE_URL not set');
  process.exit(1);
}
if (!RESEND_API_KEY) {
  logErr('RESEND_API_KEY not set');
  process.exit(1);
}

const resend = new Resend(RESEND_API_KEY);

// ---------- Types ----------

interface UserRow extends Record<string, unknown> {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

interface NocTicketRow extends Record<string, unknown> {
  id: string;
  ticket_uid: string;
  title: string;
  status: string;
  priority: string | null;
  source: string | null;
  assigned_to: string | null;
  assigned_team_id: string | null;
  created_at: string;
}

interface HsAuditRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  project_name: string | null;
  audit_type: string | null;
  status: string;
  created_at: string;
  user_id: string | null;
}

interface MancoItemRow extends Record<string, unknown> {
  id: string;
  action_item: string;
  status: string;
  fibreflow_responsible: string | null;
  fibreflow_priority: string | null;
  department: string | null;
  created_at: string;
}

interface TeamMembershipRow extends Record<string, unknown> {
  user_id: string;
  team_id: string;
}

// Bucket of tickets per user
interface Bucket {
  user: UserRow;
  mine: StandupTicket[];
  team: StandupTicket[];
}

// ---------- Helpers ----------

function friendlyName(u: UserRow): string {
  if (u.first_name && u.first_name.trim()) return u.first_name.trim();
  return u.email.split('@')[0];
}

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString('en-ZA', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function normaliseName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function mapNocPriority(p: string | null): StandupTicket['priority'] {
  if (!p) return 'normal';
  const v = p.toLowerCase();
  if (v === 'critical' || v === 'urgent') return 'critical';
  if (v === 'high') return 'high';
  if (v === 'medium' || v === 'med') return 'medium';
  if (v === 'low') return 'low';
  return 'normal';
}

function ensureBucket(map: Map<string, Bucket>, user: UserRow): Bucket {
  let b = map.get(user.id);
  if (!b) {
    b = { user, mine: [], team: [] };
    map.set(user.id, b);
  }
  return b;
}

// ---------- Main ----------

async function main() {
  // Dynamic import so the pg.Pool in src/lib/db.ts initialises with the
  // DATABASE_URL that dotenv resolved above (a static import would hoist
  // above dotenv.config and capture an undefined connection string).
  const { sql } = await import('../../src/lib/db-pool');

  const startedAt = new Date();
  logOut(
    `Starting morning standup job at ${startedAt.toISOString()}` +
      (DRY_RUN ? ' [DRY-RUN — no emails will be sent]' : '') +
      (ONLY_EMAIL ? ` [ONLY=${ONLY_EMAIL}]` : '')
  );

  // 1. Load all active users (we need them for name lookup + recipient list)
  const users = (await sql`
    SELECT id, email, first_name, last_name
    FROM users
    WHERE is_active = true AND email IS NOT NULL
  `) as UserRow[];

  const userById = new Map<string, UserRow>(users.map((u) => [u.id, u]));

  // Name index for best-effort matching (ManCo free-text assignee)
  const userByName = new Map<string, UserRow>();
  for (const u of users) {
    const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    if (full) userByName.set(normaliseName(full), u);
    if (u.first_name) userByName.set(normaliseName(u.first_name), u);
  }

  logOut(`Loaded ${users.length} active users`);

  // 2. Load team memberships (team_members joins to users via email)
  const memberships = (await sql`
    SELECT u.id AS user_id, tm.team_id::text AS team_id
    FROM team_members tm
    JOIN users u ON LOWER(u.email) = LOWER(tm.email)
    WHERE tm.is_active = true AND tm.email IS NOT NULL AND tm.team_id IS NOT NULL
  `) as TeamMembershipRow[];

  const teamToUsers = new Map<string, string[]>();
  for (const m of memberships) {
    const arr = teamToUsers.get(m.team_id) ?? [];
    arr.push(m.user_id);
    teamToUsers.set(m.team_id, arr);
  }
  logOut(`Loaded ${memberships.length} team memberships across ${teamToUsers.size} teams`);

  const buckets = new Map<string, Bucket>();

  // 3. NOC tickets — open statuses only
  const nocRows = (await sql`
    SELECT id::text, ticket_uid, title, status, priority, source,
           assigned_to::text, assigned_team_id::text, created_at
    FROM maintenance_tickets
    WHERE status IN ('open', 'assigned', 'in_progress', 'on_hold')
      AND (assigned_to IS NOT NULL OR assigned_team_id IS NOT NULL)
  `) as NocTicketRow[];
  logOut(`Loaded ${nocRows.length} open NOC tickets with an assignee/team`);

  for (const row of nocRows) {
    const ticket: StandupTicket = {
      ref: row.ticket_uid,
      source: 'noc' as StandupTicketSource,
      sourceDetail: row.source ?? undefined,
      title: row.title,
      status: row.status.replace(/_/g, ' '),
      priority: mapNocPriority(row.priority),
      url: `${APP_URL}/noc/tickets/${row.id}`,
      createdAt: row.created_at,
    };

    // My Tickets
    if (row.assigned_to && userById.has(row.assigned_to)) {
      ensureBucket(buckets, userById.get(row.assigned_to)!).mine.push(ticket);
    }

    // Team Tickets — fan out to team members excluding the direct assignee
    if (row.assigned_team_id && teamToUsers.has(row.assigned_team_id)) {
      const memberIds = teamToUsers.get(row.assigned_team_id)!;
      for (const uid of memberIds) {
        if (uid === row.assigned_to) continue; // already in "mine"
        const user = userById.get(uid);
        if (!user) continue;
        ensureBucket(buckets, user).team.push(ticket);
      }
    }
  }

  // 4. H&S audits — open = in_progress / requires_action
  const hsRows = (await sql`
    SELECT a.id::text, a.project_id::text, p.project_name AS project_name,
           a.audit_type, a.status, a.created_at,
           s.user_id::text AS user_id
    FROM hs_project_audits a
    LEFT JOIN projects p ON p.id = a.project_id
    LEFT JOIN staff s ON s.id = a.auditor_id
    WHERE a.status IN ('in_progress', 'requires_action')
      AND s.user_id IS NOT NULL
  `) as HsAuditRow[];
  logOut(`Loaded ${hsRows.length} open H&S audits with a mapped user`);

  for (const row of hsRows) {
    if (!row.user_id || !userById.has(row.user_id)) continue;
    const ticket: StandupTicket = {
      ref: `HS-${row.id.slice(0, 8)}`,
      source: 'hs' as StandupTicketSource,
      sourceDetail: row.audit_type ?? 'audit',
      title: row.project_name ? `${row.project_name} — audit` : 'H&S audit',
      status: row.status.replace(/_/g, ' '),
      url: `${APP_URL}/health-safety/audits/${row.id}`,
      createdAt: row.created_at,
    };
    ensureBucket(buckets, userById.get(row.user_id)!).mine.push(ticket);
  }

  // 5. ManCo action items — free-text responsible person, best-effort name match
  const mancoRows = (await sql`
    SELECT id::text, action_item, status, fibreflow_responsible, fibreflow_priority,
           department, created_at
    FROM manco_action_items
    WHERE status IN ('pending', 'in_progress')
      AND fibreflow_responsible IS NOT NULL
      AND fibreflow_responsible <> ''
  `) as MancoItemRow[];
  logOut(`Loaded ${mancoRows.length} open ManCo action items`);

  let mancoMatched = 0;
  let mancoUnmatched = 0;
  for (const row of mancoRows) {
    const key = normaliseName(row.fibreflow_responsible ?? '');
    const user = key ? userByName.get(key) : undefined;
    if (!user) {
      mancoUnmatched++;
      continue;
    }
    mancoMatched++;
    const ticket: StandupTicket = {
      ref: `MA-${row.id.slice(0, 8)}`,
      source: 'manco' as StandupTicketSource,
      sourceDetail: row.department ?? 'action item',
      title: row.action_item.length > 140 ? row.action_item.slice(0, 137) + '...' : row.action_item,
      status: row.status.replace(/_/g, ' '),
      priority: row.fibreflow_priority
        ? (row.fibreflow_priority.toLowerCase() as StandupTicket['priority'])
        : 'normal',
      url: `${APP_URL}/manco/action-items`,
      createdAt: row.created_at,
    };
    ensureBucket(buckets, user).mine.push(ticket);
  }
  logOut(
    `ManCo assignee match: ${mancoMatched} matched, ${mancoUnmatched} unmatched (no user found by name)`
  );

  // 6. Send emails — skip empty buckets
  const dateLabel = formatDateLabel(startedAt);
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const bucket of buckets.values()) {
    if (bucket.mine.length === 0 && bucket.team.length === 0) {
      skippedCount++;
      continue;
    }

    // --only=<email> filter: skip anyone who isn't the test target
    if (ONLY_EMAIL && bucket.user.email.toLowerCase() !== ONLY_EMAIL) {
      skippedCount++;
      continue;
    }

    const html = generateMorningStandupEmail({
      recipientName: friendlyName(bucket.user),
      myTickets: bucket.mine,
      teamTickets: bucket.team,
      dateLabel,
      appUrl: APP_URL,
    });

    const subject = `Morning Standup · ${bucket.mine.length} mine · ${bucket.team.length} team`;

    if (DRY_RUN) {
      logOut(
        `DRY-RUN ${bucket.user.email} (mine=${bucket.mine.length} team=${bucket.team.length}) subject="${subject}"`
      );
      successCount++;
      continue;
    }

    try {
      const result = await resend.emails.send({
        from: FROM_ADDRESS,
        to: bucket.user.email,
        subject,
        html,
      });
      if (result.error) {
        logErr(`FAIL ${bucket.user.email}: ${fmtErr(result.error)}`);
        errorCount++;
      } else {
        logOut(
          `SENT ${bucket.user.email} (mine=${bucket.mine.length} team=${bucket.team.length}) id=${result.data?.id}`
        );
        successCount++;
      }
    } catch (err) {
      logErr(`ERROR ${bucket.user.email}: ${fmtErr(err)}`);
      errorCount++;
    }

    // Rate limiting — Resend allows ~10/sec
    await new Promise((r) => setTimeout(r, 120));
  }

  logOut('');
  logOut('Summary:');
  logOut(`  Recipients with tickets : ${successCount + errorCount}`);
  logOut(`  Sent successfully       : ${successCount}`);
  logOut(`  Failed                  : ${errorCount}`);
  logOut(`  Skipped (empty buckets) : ${skippedCount}`);
  logOut('Morning standup job completed');
}

// pg.Pool keeps the event loop alive after work completes, so exit explicitly
// (matching the sibling attendance crons). All queries + email sends are
// awaited before this resolves, so a hard exit loses nothing.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    logErr(`Fatal error: ${fmtErr(err)}`);
    process.exit(1);
  });
