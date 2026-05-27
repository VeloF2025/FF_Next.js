#!/usr/bin/env node
/**
 * Fireflies Meetings Sync Cron Job
 *
 * Syncs Fireflies meeting transcripts to Neon database, extracts action items,
 * and sends email notification.
 *
 * Usage:
 *   npx tsx scripts/cron/sync-meetings-fireflies.ts
 *
 * VPS Cron Setup (8 PM SAST = 18:00 UTC daily):
 *   0 18 * * * cd /var/www/fibreflow && /usr/bin/npx tsx scripts/cron/sync-meetings-fireflies.ts >> /var/log/meetings-sync.log 2>&1
 */

import type { NeonQueryFunction } from '@neondatabase/serverless';
import { Resend } from 'resend';
import { syncFirefliesToNeon } from '../../src/services/fireflies/firefliesService';
import {
  parseFirefliesActionItems,
  findAssigneeEmail,
} from '../../src/services/action-items/actionItemsParser';

// Load environment variables — try .env.local first, fallback to .env.production
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: '.env.production' });
}

// DB driver: post-Neon-cutover (2026-04-18) the database is self-hosted
// Supabase, which the @neondatabase/serverless neon() driver cannot talk to,
// and the webpack neon-shim that rescues the Next.js app does not apply to a
// standalone tsx script. Use the shared pg.Pool via `@/lib/db-pool` (its `sql`
// is a tagged-template drop-in), imported dynamically inside main() so the
// pool — built from process.env.DATABASE_URL at db.ts module load — sees the
// resolved URL. Output goes to stdout/stderr because @/lib/logger never writes
// to them (in-memory only) and would blank this cron's logfile.
const logOut = (msg: string) => process.stdout.write(msg + '\n');
const logErr = (msg: string) => process.stderr.write(msg + '\n');
const fmtErr = (e: unknown) =>
  e instanceof Error ? e.stack ?? e.message : JSON.stringify(e);

const DATABASE_URL = process.env.DATABASE_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FIREFLIES_API_KEY = process.env.FIREFLIES_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'ai@velocityfibre.co.za';

if (!DATABASE_URL) {
  logErr('❌ DATABASE_URL not set');
  process.exit(1);
}

if (!RESEND_API_KEY) {
  logErr('❌ RESEND_API_KEY not set');
  process.exit(1);
}

if (!FIREFLIES_API_KEY) {
  logErr('❌ FIREFLIES_API_KEY not set');
  process.exit(1);
}

const resend = new Resend(RESEND_API_KEY);

interface SyncStats {
  meetingCount: number;
  actionItemsExtracted: number;
  actionItemsSkipped: number;
  actionItemsErrors: number;
}

// Shape of the rows returned by the meetings query below. `extends
// Record<string, unknown>` satisfies db-pool's SqlRow constraint so the typed
// `sql<MeetingRow>` call compiles. summary/participants are jsonb, returned
// already-parsed by node-postgres.
interface MeetingRow extends Record<string, unknown> {
  id: number;
  title: string | null;
  summary: { action_items?: string } | null;
  participants: Array<{ name: string; email: string; displayName?: string }> | null;
}

function generateEmailHtml(success: boolean, stats?: SyncStats, error?: string): string {
  const timestamp = new Date().toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    dateStyle: 'full',
    timeStyle: 'short'
  });

  if (success && stats) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #10b981; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
    .success { color: #10b981; font-size: 48px; }
    .stats { background: white; padding: 15px; border-radius: 6px; margin: 15px 0; }
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
    .stat-box { background: #f9fafb; padding: 10px; border-radius: 4px; text-align: center; }
    .stat-number { font-size: 24px; font-weight: bold; color: #10b981; }
    .stat-label { font-size: 12px; color: #6b7280; margin-top: 5px; }
    .footer { color: #6b7280; font-size: 12px; margin-top: 20px; text-align: center; }
    .btn { display: inline-block; background: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin: 5px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">✅ Fireflies Sync Success</h1>
    </div>
    <div class="content">
      <div class="success">✓</div>
      <h2>Meetings & Action Items Synchronized</h2>

      <div class="stats">
        <p><strong>⏰ Sync Time:</strong> ${timestamp}</p>
        <p><strong>🔄 Status:</strong> Completed</p>

        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-number">${stats.meetingCount}</div>
            <div class="stat-label">Meetings Synced</div>
          </div>
          <div class="stat-box">
            <div class="stat-number">${stats.actionItemsExtracted}</div>
            <div class="stat-label">New Action Items</div>
          </div>
          <div class="stat-box">
            <div class="stat-number">${stats.actionItemsSkipped}</div>
            <div class="stat-label">Already Processed</div>
          </div>
          <div class="stat-box">
            <div class="stat-number">${stats.actionItemsErrors}</div>
            <div class="stat-label">Errors</div>
          </div>
        </div>
      </div>

      <p>The daily Fireflies sync has completed successfully. All meeting transcripts and action items have been synchronized to the database.</p>

      <div style="text-align: center;">
        <a href="https://app.fibreflow.app/meetings" class="btn">View Meetings</a>
        <a href="https://app.fibreflow.app/action-items/pending" class="btn">View Action Items</a>
      </div>

      <div class="footer">
        <p>This is an automated notification from FibreFlow Meetings Sync</p>
        <p>Next sync scheduled for tomorrow at 8:00 PM SAST</p>
      </div>
    </div>
  </div>
</body>
</html>
    `;
  } else {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #ef4444; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #fef2f2; padding: 20px; border: 1px solid #fecaca; border-top: none; border-radius: 0 0 8px 8px; }
    .error { color: #ef4444; font-size: 48px; }
    .error-details { background: white; padding: 15px; border-radius: 6px; margin: 15px 0; border-left: 4px solid #ef4444; }
    .footer { color: #6b7280; font-size: 12px; margin-top: 20px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">❌ Fireflies Sync Failed</h1>
    </div>
    <div class="content">
      <div class="error">✗</div>
      <h2>Sync Error Detected</h2>

      <div class="error-details">
        <p><strong>⏰ Failed At:</strong> ${timestamp}</p>
        <p><strong>❌ Error:</strong></p>
        <pre style="background: #f9fafb; padding: 10px; border-radius: 4px; overflow-x: auto;">${error || 'Unknown error'}</pre>
      </div>

      <p><strong>Action Required:</strong></p>
      <ul>
        <li>Check the Fireflies API key is valid</li>
        <li>Verify network connectivity to Fireflies API</li>
        <li>Review server logs: <code>/var/log/meetings-sync.log</code></li>
        <li>Check database connection</li>
      </ul>

      <p>
        <a href="https://app.fibreflow.app/meetings" style="display: inline-block; background: #ef4444; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin-top: 10px;">
          Check Meetings Dashboard
        </a>
      </p>

      <div class="footer">
        <p>This is an automated error notification from FibreFlow Meetings Sync</p>
        <p>Next sync attempt scheduled for tomorrow at 8:00 PM SAST</p>
      </div>
    </div>
  </div>
</body>
</html>
    `;
  }
}

async function main() {
  // Dynamic import so the pg.Pool in src/lib/db.ts initialises with the
  // DATABASE_URL dotenv resolved above (a static import would hoist above
  // dotenv.config and capture an undefined connection string).
  const { sql } = await import('../../src/lib/db-pool');

  logOut('🚀 Starting Fireflies meetings sync cron job...');
  logOut(`📅 Date: ${new Date().toISOString()}`);

  let syncedCount = 0;
  let actionItemsExtracted = 0;
  let actionItemsSkipped = 0;
  let actionItemsErrors = 0;
  let success = false;
  let errorMessage = '';

  try {
    // STEP 1: Sync meetings from Fireflies
    logOut('🔄 Step 1: Syncing meetings from Fireflies...');
    // syncFirefliesToNeon is typed for the Neon driver but only uses the
    // tagged-template call surface, which db-pool's `sql` implements
    // identically (and parameterises). The shared service + its app callers
    // still pass the webpack-shimmed neon sql, so we adapt at this call site
    // rather than widening the service signature.
    syncedCount = await syncFirefliesToNeon(
      FIREFLIES_API_KEY,
      sql as unknown as NeonQueryFunction<false, false>
    );
    logOut(`✅ Successfully synced ${syncedCount} meetings`);

    // STEP 2: Extract action items from meetings
    logOut('🔄 Step 2: Extracting action items from meetings...');

    // Find all meetings with action items
    const meetings = await sql<MeetingRow>`
      SELECT id, title, summary, participants
      FROM meetings
      WHERE summary IS NOT NULL
      AND summary->>'action_items' IS NOT NULL
      AND summary->>'action_items' != ''
    `;

    logOut(`📋 Found ${meetings.length} meetings with action items`);

    for (const meeting of meetings) {
      try {
        // Check if already extracted
        const existing = await sql<{ count: number }>`
          SELECT COUNT(*)::int as count
          FROM action_items
          WHERE meeting_id = ${meeting.id}
        `;

        if ((existing[0]?.count ?? 0) > 0) {
          actionItemsSkipped++;
          continue;
        }

        // Parse action items
        const actionItemsText = meeting.summary?.action_items;
        if (!actionItemsText) {
          continue;
        }

        const parsedItems = parseFirefliesActionItems(actionItemsText);

        // Insert action items
        for (const item of parsedItems) {
          const assignee_email = findAssigneeEmail(item.assignee, meeting.participants ?? []);

          await sql`
            INSERT INTO action_items (
              meeting_id,
              description,
              assignee_name,
              assignee_email,
              mentioned_at,
              status,
              priority
            ) VALUES (
              ${meeting.id},
              ${item.description},
              ${item.assignee},
              ${assignee_email || null},
              ${item.mentioned_at || null},
              'pending',
              'medium'
            )
          `;

          actionItemsExtracted++;
        }

        logOut(`  ✅ ${meeting.title}: ${parsedItems.length} items`);
      } catch (error) {
        logErr(`  ❌ ${meeting.title}: ${fmtErr(error)}`);
        actionItemsErrors++;
      }
    }

    logOut(`✅ Extracted ${actionItemsExtracted} action items (${actionItemsSkipped} already processed, ${actionItemsErrors} errors)`);
    success = true;

  } catch (error) {
    success = false;
    errorMessage = error instanceof Error ? error.message : String(error);
    logErr(`❌ Sync failed: ${errorMessage}`);
  }

  // Send email notification
  try {
    logOut('📧 Sending email notification...');

    const stats: SyncStats = {
      meetingCount: syncedCount,
      actionItemsExtracted,
      actionItemsSkipped,
      actionItemsErrors,
    };

    const emailHtml = generateEmailHtml(success, stats, errorMessage);
    const subject = success
      ? `✅ Fireflies Sync Success - ${syncedCount} meetings, ${actionItemsExtracted} new action items`
      : '❌ Fireflies Sync Failed - Action Required';

    const result = await resend.emails.send({
      from: 'FibreFlow Meetings <meetings@fibreflow.app>',
      to: ADMIN_EMAIL,
      subject: subject,
      html: emailHtml
    });

    if (result.error) {
      logErr(`❌ Failed to send email notification: ${fmtErr(result.error)}`);
    } else {
      logOut(`✅ Email notification sent (ID: ${result.data?.id})`);
    }

  } catch (emailError) {
    logErr(`❌ Error sending email: ${fmtErr(emailError)}`);
  }

  // Summary
  logOut('\n📊 Summary:');
  logOut(`  🔄 Sync Status: ${success ? '✅ Success' : '❌ Failed'}`);
  logOut(`  📊 Meetings Synced: ${syncedCount}`);
  logOut(`  📋 Action Items Extracted: ${actionItemsExtracted}`);
  logOut(`  ⏭️  Already Processed: ${actionItemsSkipped}`);
  logOut(`  ❌ Errors: ${actionItemsErrors}`);
  if (!success) {
    logOut(`  ❌ Error: ${errorMessage}`);
  }
  logOut('✅ Cron job completed\n');

  // Exit with error code if sync failed
  if (!success) {
    process.exit(1);
  }
}

// pg.Pool keeps the event loop alive after work completes, so exit explicitly
// (matching the sibling attendance crons). All queries, the INSERT loop, and
// the email send are awaited before this resolves, so a hard exit loses
// nothing.
main()
  .then(() => process.exit(0))
  .catch(error => {
    logErr(`💥 Unhandled error: ${fmtErr(error)}`);
    process.exit(1);
  });
