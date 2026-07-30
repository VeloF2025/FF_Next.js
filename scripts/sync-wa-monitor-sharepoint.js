#!/usr/bin/env node
/**
 * WA Monitor SharePoint Sync Cron Job
 * Syncs daily drops per project to SharePoint NeonDbase sheet
 *
 * Usage: node scripts/sync-wa-monitor-sharepoint.js
 * Cron: Runs daily at 8pm SAST (18:00 SAST = 16:00 UTC)
 *
 * Email notifications sent to: ai@velocityfibre.co.za
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
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
const API_URL = 'http://localhost:3005/api/wa-monitor-sync-sharepoint';
const LOG_PREFIX = '[WA Monitor SharePoint Sync]';
const NOTIFICATION_EMAILS = ['ai@velocityfibre.co.za'];
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

/**
 * Get current timestamp in South African timezone
 */
function getSATimestamp() {
  return new Date().toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

/**
 * Log message with timestamp
 */
function log(message, data = null) {
  const timestamp = getSATimestamp();
  console.log(`${LOG_PREFIX} [${timestamp}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

/**
 * Send email notification via Resend API
 */
async function sendEmailNotification(subject, htmlContent, textContent) {
  if (!RESEND_API_KEY) {
    log('⚠️  RESEND_API_KEY not set, skipping email notification');
    return false;
  }

  return new Promise((resolve, reject) => {
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
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          log('✅ Email notification sent successfully');
          resolve(true);
        } else {
          log('❌ Failed to send email notification', { statusCode: res.statusCode, response: data });
          resolve(false);
        }
      });
    });

    req.on('error', (error) => {
      log('❌ Email notification error', { error: error.message });
      resolve(false);
    });

    req.write(emailData);
    req.end();
  });
}

/**
 * Generate email HTML content
 */
function generateEmailHTML(data) {
  const statusEmoji = data.status === 'success' ? '✅' : data.status === 'partial' ? '⚠️' : '❌';
  const statusColor = data.status === 'success' ? '#10b981' : data.status === 'partial' ? '#f59e0b' : '#ef4444';
  const statusText = data.status === 'success' ? 'Success' : data.status === 'partial' ? 'Partial Success' : 'Failed';

  // Generate project summary table
  let projectsHTML = '';
  if (data.projects && data.projects.length > 0) {
    projectsHTML = `
      <div style="margin-top: 24px;">
        <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #111827;">Projects Synced to SharePoint</h3>
        <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden;">
          <thead>
            <tr style="background-color: #f9fafb;">
              <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: #6b7280; border-bottom: 1px solid #e5e7eb;">Project</th>
              <th style="padding: 12px; text-align: right; font-size: 12px; font-weight: 600; color: #6b7280; border-bottom: 1px solid #e5e7eb;">Drops</th>
            </tr>
          </thead>
          <tbody>
            ${data.projects.map((project, index) => `
              <tr style="background-color: ${index % 2 === 0 ? '#ffffff' : '#f9fafb'};">
                <td style="padding: 12px; font-size: 14px; color: #111827; border-bottom: ${index === data.projects.length - 1 ? 'none' : '1px solid #e5e7eb'};">${project.project}</td>
                <td style="padding: 12px; text-align: right; font-size: 14px; font-weight: 600; color: #111827; border-bottom: ${index === data.projects.length - 1 ? 'none' : '1px solid #e5e7eb'};">${project.count}</td>
              </tr>
            `).join('')}
            <tr style="background-color: #f0fdf4;">
              <td style="padding: 12px; font-size: 14px; font-weight: 700; color: #166534;">Total</td>
              <td style="padding: 12px; text-align: right; font-size: 14px; font-weight: 700; color: #166534;">${data.projects.reduce((sum, p) => sum + p.count, 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>SharePoint Sync - ${statusText}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px;">
          <tr>
            <td style="padding: 32px 40px; background-color: ${statusColor}; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px;">
                ${statusEmoji} WA Monitor SharePoint Sync
              </h1>
              <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">
                ${data.date}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 40px;">
              <h2 style="margin: 0 0 16px 0; font-size: 18px; color: #111827;">Status: ${statusText}</h2>
              <p style="margin: 0 0 24px 0; font-size: 14px; color: #6b7280;">${data.message}</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 12px; background-color: #f0fdf4; border-radius: 6px; width: 33%;">
                    <p style="margin: 0; font-size: 12px; color: #166534;">SUCCEEDED</p>
                    <p style="margin: 4px 0 0 0; font-size: 24px; font-weight: 700; color: #15803d;">${data.succeeded}</p>
                  </td>
                  <td style="width: 2%;"></td>
                  <td style="padding: 12px; background-color: #fef2f2; border-radius: 6px; width: 33%;">
                    <p style="margin: 0; font-size: 12px; color: #991b1b;">FAILED</p>
                    <p style="margin: 4px 0 0 0; font-size: 24px; font-weight: 700; color: #dc2626;">${data.failed}</p>
                  </td>
                  <td style="width: 2%;"></td>
                  <td style="padding: 12px; background-color: #f3f4f6; border-radius: 6px; width: 33%;">
                    <p style="margin: 0; font-size: 12px; color: #374151;">TOTAL</p>
                    <p style="margin: 4px 0 0 0; font-size: 24px; font-weight: 700; color: #1f2937;">${data.total}</p>
                  </td>
                </tr>
              </table>
              ${data.duration ? `<p style="margin: 16px 0 0 0; font-size: 14px; color: #6b7280;"><strong>Duration:</strong> ${data.duration}</p>` : ''}
              ${projectsHTML}
              ${data.error ? `<div style="margin-top: 16px; padding: 16px; background-color: #fef2f2; border-radius: 6px; border-left: 4px solid #ef4444;"><p style="margin: 0; font-size: 13px; color: #7f1d1d;">${data.error}</p></div>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 40px; background-color: #f9fafb; border-radius: 0 0 8px 8px;">
              <p style="margin: 0 0 12px 0; font-size: 12px; color: #6b7280; text-align: center;">
                <a href="https://blitzfibre.sharepoint.com/:x:/s/Velocity_Manco/EYm7g0w6Y1dFgGB_m4YlBxgBeVJpoDXAYjdvK-ZfgHoOqA" style="color: #2563eb; text-decoration: none; font-weight: 600;">📊 View SharePoint (NeonDbase Sheet)</a>
              </p>
              <p style="margin: 0; font-size: 12px; color: #6b7280; text-align: center;">
                <a href="https://app.fibreflow.app/wa-monitor" style="color: #2563eb; text-decoration: none;">📈 View FibreFlow Dashboard</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Generate email plain text content
 */
function generateEmailText(data) {
  const statusText = data.status === 'success' ? 'SUCCESS' : data.status === 'partial' ? 'PARTIAL SUCCESS' : 'FAILED';

  let text = `
WA Monitor SharePoint Sync Report
Date: ${data.date}
Status: ${statusText}

${data.message}

Statistics:
- Succeeded: ${data.succeeded}
- Failed: ${data.failed}
- Total: ${data.total}
`;

  if (data.duration) {
    text += `\nDuration: ${data.duration}`;
  }

  // Add project details
  if (data.projects && data.projects.length > 0) {
    text += `\n\nProjects Synced to SharePoint:\n`;
    data.projects.forEach(project => {
      text += `- ${project.project}: ${project.count} drops\n`;
    });
    const totalDrops = data.projects.reduce((sum, p) => sum + p.count, 0);
    text += `\nTotal Drops: ${totalDrops}`;
  }

  if (data.error) {
    text += `\n\nError Details:\n${data.error}`;
  }

  text += `\n\nLinks:`;
  text += `\n📊 SharePoint: https://blitzfibre.sharepoint.com/:x:/s/Velocity_Manco/EYm7g0w6Y1dFgGB_m4YlBxgBeVJpoDXAYjdvK-ZfgHoOqA`;
  text += `\n📈 Dashboard: https://app.fibreflow.app/wa-monitor`;

  return text.trim();
}

/**
 * Call SharePoint sync API
 */
async function syncToSharePoint() {
  return new Promise((resolve, reject) => {
    const url = new URL(API_URL);

    const options = {
      hostname: url.hostname,
      port: url.port || 3005,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 60000, // 60 second timeout
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);

          if (res.statusCode === 200) {
            resolve(response);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${response.error?.message || response.message || 'Unknown error'}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out after 60 seconds'));
    });

    req.end();
  });
}

/**
 * Main execution
 */
async function main() {
  const startTime = Date.now();
  log('Starting daily SharePoint sync...');

  try {
    // Call sync API
    const result = await syncToSharePoint();
    const duration = ((Date.now() - startTime) / 1000).toFixed(1) + 's';

    // Check if successful
    if (result.success) {
      const data = result.data || {};
      const succeeded = data.succeeded || 0;
      const failed = data.failed || 0;
      const total = data.total || 0;

      log('✅ Sync completed', {
        succeeded,
        failed,
        total,
        message: data.message || 'No message',
        date: data.date || new Date().toISOString().split('T')[0],
        duration,
      });

      // Determine status for email
      const status = failed === 0 ? 'success' : 'partial';
      const subject = status === 'success'
        ? '✅ WA Monitor SharePoint Sync - Success'
        : '⚠️ WA Monitor SharePoint Sync - Partial Success';

      // Prepare email data
      const emailData = {
        status,
        date: data.date || new Date().toISOString().split('T')[0],
        succeeded,
        failed,
        total,
        message: data.message || 'Sync completed',
        duration,
        projects: data.projects || [], // Include project details
      };

      // Send email notification
      await sendEmailNotification(
        subject,
        generateEmailHTML(emailData),
        generateEmailText(emailData)
      );

      // Exit with error code if any writes failed
      if (failed > 0) {
        log('⚠️  Some writes failed - check logs above');
        process.exit(1);
      }

      process.exit(0);
    } else {
      const errorMessage = result.error || 'Unknown error';
      log('❌ Sync failed', { error: errorMessage });

      // Send failure email
      const emailData = {
        status: 'failure',
        date: new Date().toISOString().split('T')[0],
        succeeded: 0,
        failed: 0,
        total: 0,
        message: 'SharePoint sync failed',
        duration: ((Date.now() - startTime) / 1000).toFixed(1) + 's',
        error: errorMessage,
      };

      await sendEmailNotification(
        '❌ WA Monitor SharePoint Sync - Failed',
        generateEmailHTML(emailData),
        generateEmailText(emailData)
      );

      process.exit(1);
    }
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
    log('❌ Error during sync', { error: error.message });

    // Send failure email
    const emailData = {
      status: 'failure',
      date: new Date().toISOString().split('T')[0],
      succeeded: 0,
      failed: 0,
      total: 0,
      message: 'SharePoint sync encountered an error',
      duration,
      error: error.message,
    };

    await sendEmailNotification(
      '❌ WA Monitor SharePoint Sync - Error',
      generateEmailHTML(emailData),
      generateEmailText(emailData)
    );

    process.exit(1);
  }
}

// Run main function
main();
