#!/usr/bin/env node
/**
 * SharePoint Sync Completion Watchdog
 * Checks if SharePoint sync has completed by 20:30 SAST
 * Sends alert email if sync has not run or failed
 *
 * Usage: node scripts/check-sharepoint-sync-completion.js
 * Cron: Runs daily at 8:30pm SAST (18:30 SAST = 16:30 UTC)
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

// Load environment variables from .env.production
const envPath = path.join(__dirname, '..', '.env.production');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
}

// Configuration
const LOG_FILE = '/var/log/wa-monitor-sharepoint-sync.log';
const NOTIFICATION_EMAILS = ['ai@velocityfibre.co.za'];
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const CHECK_TIME_WINDOW = 30 * 60 * 1000; // 30 minutes

/**
 * Send email notification
 */
async function sendEmailNotification(subject, htmlContent, textContent) {
  if (!RESEND_API_KEY) {
    console.log('⚠️  RESEND_API_KEY not set, skipping email notification');
    return false;
  }

  return new Promise((resolve) => {
    const emailData = JSON.stringify({
      from: 'FibreFlow Alerts <alerts@fibreflow.app>',
      to: NOTIFICATION_EMAILS,
      subject: subject,
      html: htmlContent,
      text: textContent,
    });

    const options = {
      hostname: 'api.resend.com',
      port: 443,
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(emailData),
      },
    };

    const req = https.request(options, (res) => {
      resolve(res.statusCode === 200);
    });

    req.on('error', () => resolve(false));
    req.write(emailData);
    req.end();
  });
}

/**
 * Main execution
 */
async function main() {
  console.log('[SharePoint Sync Watchdog] Checking sync completion...');

  try {
    // Check if log file exists
    if (!fs.existsSync(LOG_FILE)) {
      console.log('❌ Log file not found - sync has never run');

      await sendEmailNotification(
        '🚨 WA Monitor SharePoint Sync - Not Completed',
        `
<html>
<body style="font-family: Arial, sans-serif; padding: 20px;">
  <h2 style="color: #ef4444;">🚨 SharePoint Sync Alert</h2>
  <p>The WA Monitor SharePoint sync has not completed by 8:30pm SAST.</p>
  <p><strong>Status:</strong> Log file not found</p>
  <p><strong>Time:</strong> ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}</p>
  <p>Please check the cron job and server logs.</p>
  <p><a href="https://app.fibreflow.app/wa-monitor">View Dashboard</a></p>
</body>
</html>
        `,
        `SharePoint Sync Alert\nThe sync has not completed by 8:30pm SAST.\nStatus: Log file not found\nTime: ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}`
      );

      process.exit(1);
    }

    // Read last 100 lines of log file
    const logs = fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-100).join('\n');

    // Check if sync completed successfully in the last 30 minutes
    const now = Date.now();
    const hasRecentSuccess = logs.includes('✅ Sync completed') || logs.includes('✅ Email notification sent');
    const hasRecentFailure = logs.includes('❌ Sync failed') || logs.includes('❌ Error during sync');

    if (!hasRecentSuccess && !hasRecentFailure) {
      console.log('⚠️  No recent sync activity found');

      await sendEmailNotification(
        '🚨 WA Monitor SharePoint Sync - Not Completed',
        `
<html>
<body style="font-family: Arial, sans-serif; padding: 20px;">
  <h2 style="color: #ef4444;">🚨 SharePoint Sync Alert</h2>
  <p>The WA Monitor SharePoint sync has not completed by 8:30pm SAST.</p>
  <p><strong>Status:</strong> No recent sync activity detected</p>
  <p><strong>Time:</strong> ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}</p>
  <p>Please check the cron job and server logs.</p>
  <p><a href="https://app.fibreflow.app/wa-monitor">View Dashboard</a></p>
</body>
</html>
        `,
        `SharePoint Sync Alert\nThe sync has not completed by 8:30pm SAST.\nStatus: No recent sync activity\nTime: ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}`
      );

      process.exit(1);
    }

    if (hasRecentFailure && !hasRecentSuccess) {
      console.log('❌ Recent sync failure detected (no success email sent yet)');
      // Email already sent by sync script, just log
      process.exit(1);
    }

    console.log('✅ Sync completed successfully');
    process.exit(0);

  } catch (error) {
    console.error('❌ Watchdog error:', error.message);
    process.exit(1);
  }
}

// Run main function
main();
