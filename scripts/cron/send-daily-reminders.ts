#!/usr/bin/env node
/**
 * Daily Reminders Cron Job
 *
 * Sends daily email reminders to users with pending reminders.
 *
 * Usage:
 *   npx tsx scripts/cron/send-daily-reminders.ts
 *
 * VPS Cron Setup (8 AM daily):
 *   0 8 * * * cd /var/www/fibreflow && /usr/bin/npx tsx scripts/cron/send-daily-reminders.ts >> /var/log/reminders-cron.log 2>&1
 */

import { Resend } from 'resend';
import { generateDailyReminderEmail } from '../../src/lib/email/templates/dailyReminder';

// Load environment variables
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.production' });

// DB driver: post-Neon-cutover (2026-04-18) the database is self-hosted
// Supabase, which the @neondatabase/serverless neon() driver cannot talk to,
// and the webpack neon-shim that rescues the Next.js app does not apply to a
// standalone tsx script. Use the shared pg.Pool via `@/lib/db-pool` (its `sql`
// is a tagged-template drop-in). Imported dynamically inside main() so the
// pool sees the DATABASE_URL dotenv resolves (src/lib/db.ts builds it at
// module load). Output goes to stdout/stderr because @/lib/logger never writes
// to them (in-memory only) and would blank this cron's logfile.
const logOut = (msg: string) => process.stdout.write(msg + '\n');
const logErr = (msg: string) => process.stderr.write(msg + '\n');
const fmtErr = (e: unknown) =>
  e instanceof Error ? e.stack ?? e.message : JSON.stringify(e);

const DATABASE_URL = process.env.DATABASE_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!DATABASE_URL) {
  logErr('❌ DATABASE_URL not set');
  process.exit(1);
}

if (!RESEND_API_KEY) {
  logErr('❌ RESEND_API_KEY not set');
  process.exit(1);
}

const resend = new Resend(RESEND_API_KEY);

interface Reminder extends Record<string, unknown> {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  due_date?: string;
  priority: 'low' | 'medium' | 'high';
  status: string;
  created_at: string;
}

interface UserWithEmail extends Record<string, unknown> {
  user_id: string;
  email: string;
  first_name?: string;
}

async function main() {
  // Dynamic import so the pg.Pool in src/lib/db.ts initialises with the
  // DATABASE_URL dotenv resolved above (a static import would hoist above
  // dotenv.config and capture an undefined connection string).
  const { sql } = await import('../../src/lib/db-pool');

  logOut('🚀 Starting daily reminders cron job...');
  logOut(`📅 Date: ${new Date().toISOString()}`);

  try {
    // Step 1: Get all users with pending reminders who have email notifications enabled
    const users = await sql`
      SELECT DISTINCT
        r.user_id,
        p.email,
        NULL as first_name
      FROM reminders r
      INNER JOIN reminder_preferences p ON r.user_id = p.user_id
      WHERE r.status = 'pending'
        AND p.enabled = true
        AND p.email IS NOT NULL
        AND (r.due_date IS NULL OR r.due_date <= CURRENT_DATE + INTERVAL '1 day')
    ` as UserWithEmail[];

    logOut(`👥 Found ${users.length} users with pending reminders`);

    if (users.length === 0) {
      logOut('✅ No users to send reminders to');
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    // Step 2: For each user, get their reminders and send email
    for (const user of users) {
      try {
        // Get user's pending reminders
        const reminders = await sql`
          SELECT *
          FROM reminders
          WHERE user_id = ${user.user_id}
            AND status = 'pending'
            AND (due_date IS NULL OR due_date <= CURRENT_DATE + INTERVAL '1 day')
          ORDER BY
            CASE priority
              WHEN 'high' THEN 1
              WHEN 'medium' THEN 2
              WHEN 'low' THEN 3
            END,
            due_date ASC NULLS LAST
        ` as Reminder[];

        if (reminders.length === 0) {
          logOut(`  ⏭️  User ${user.email}: No reminders to send`);
          continue;
        }

        // Generate email HTML
        const emailHtml = generateDailyReminderEmail(reminders);

        // Send email via Resend
        // Note: Requires fibreflow.app domain to be verified in Resend
        // See docs/RESEND_DOMAIN_SETUP.md for DNS setup instructions
        const result = await resend.emails.send({
          from: 'FibreFlow Reminders <reminders@fibreflow.app>',
          to: user.email,
          subject: `Your Daily Reminders (${reminders.length} pending)`,
          html: emailHtml
        });

        if (result.error) {
          logErr(`  ❌ User ${user.email}: Failed to send ${fmtErr(result.error)}`);
          errorCount++;
        } else {
          logOut(`  ✅ User ${user.email}: Sent ${reminders.length} reminders (ID: ${result.data?.id})`);
          successCount++;
        }

        // Rate limiting: wait 100ms between emails to avoid Resend rate limits
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        logErr(`  ❌ User ${user.email}: Error processing ${fmtErr(error)}`);
        errorCount++;
      }
    }

    // Summary
    logOut('\n📊 Summary:');
    logOut(`  ✅ Success: ${successCount}`);
    logOut(`  ❌ Errors: ${errorCount}`);
    logOut(`  📧 Total processed: ${users.length}`);
    logOut('✅ Cron job completed\n');

  } catch (error) {
    logErr(`❌ Fatal error: ${fmtErr(error)}`);
    process.exit(1);
  }
}

// pg.Pool keeps the event loop alive after work completes, so exit explicitly
// (matching the sibling attendance crons). All queries + email sends are
// awaited before this resolves, so a hard exit loses nothing.
main()
  .then(() => process.exit(0))
  .catch(error => {
    logErr(`💥 Unhandled error: ${fmtErr(error)}`);
    process.exit(1);
  });
