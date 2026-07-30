#!/usr/bin/env node
/**
 * Test Email Script - Send a sample reminder email
 * Usage: npx tsx scripts/cron/test-email.ts
 */

import { Resend } from 'resend';
import { generateDailyReminderEmail } from '../../src/lib/email/templates/dailyReminder';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.production' });

const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!RESEND_API_KEY) {
  console.error('❌ RESEND_API_KEY not set');
  process.exit(1);
}

const resend = new Resend(RESEND_API_KEY);

// Sample reminders for testing
const sampleReminders = [
  {
    id: '1',
    title: 'Review contractor invoices',
    description: 'Check and approve pending invoices from contractors for this week',
    due_date: new Date().toISOString().split('T')[0], // Today
    priority: 'high' as const,
    status: 'pending'
  },
  {
    id: '2',
    title: 'Update project timeline',
    description: 'Sync with the team on Project Millennium progress',
    due_date: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Tomorrow
    priority: 'medium' as const,
    status: 'pending'
  },
  {
    id: '3',
    title: 'Order fiber supplies',
    description: 'Place order for additional fiber spools for next month',
    due_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0], // Next week
    priority: 'medium' as const,
    status: 'pending'
  },
  {
    id: '4',
    title: 'Schedule team meeting',
    description: 'Plan Q1 review meeting with all department heads',
    priority: 'low' as const,
    status: 'pending'
  }
];

async function sendTestEmail() {
  console.log('📧 Sending test reminder email...');
  console.log(`📮 To: ai@velocityfibre.co.za`);
  console.log(`📋 Reminders: ${sampleReminders.length}`);
  console.log('');

  try {
    // Generate email HTML
    const emailHtml = generateDailyReminderEmail(sampleReminders);

    // Send email via Resend
    // Domain fibreflow.app is now verified - can send to any email address!
    const result = await resend.emails.send({
      from: 'FibreFlow Reminders <reminders@fibreflow.app>',
      to: 'ai@velocityfibre.co.za',
      subject: `[TEST] Your Daily Reminders (${sampleReminders.length} pending)`,
      html: emailHtml
    });

    if (result.error) {
      console.error('❌ Failed to send email:', result.error);
      process.exit(1);
    }

    console.log('✅ Test email sent successfully!');
    console.log(`📨 Email ID: ${result.data?.id}`);
    console.log('');
    console.log('Check your inbox at ai@velocityfibre.co.za');
    console.log('(Check spam folder if not in inbox)');

  } catch (error) {
    console.error('❌ Error sending test email:', error);
    process.exit(1);
  }
}

sendTestEmail().catch(error => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});
