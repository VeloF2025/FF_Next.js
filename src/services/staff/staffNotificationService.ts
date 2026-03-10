/**
 * Staff Notification Service
 * Handles email notifications for birthdays, document expiry, and compliance alerts
 */

import { neon } from '@/lib/db-neon';
import { formatDisplayDateShort, formatDisplayDate } from '@/utils/dateFormat';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

// Notification configuration
interface NotificationConfig {
  fromEmail: string;
  fromName: string;
  defaultRecipient: string;
  enabled: boolean;
}

const notificationConfig: NotificationConfig = {
  fromEmail: process.env.STAFF_ALERT_FROM_EMAIL || 'alerts@fibreflow.com',
  fromName: process.env.STAFF_ALERT_FROM_NAME || 'FibreFlow Staff Alerts',
  defaultRecipient: process.env.STAFF_ALERT_EMAIL || 'hr@fibreflow.com',
  enabled: process.env.STAFF_ALERTS_ENABLED !== 'false',
};

// Alert types
export interface BirthdayAlert {
  id: string;
  name: string;
  email: string | null;
  dateOfBirth: string;
  department: string | null;
  position: string | null;
  daysUntil: number;
  age: number;
}

export interface ExpiryAlert {
  id: string;
  staffId: string;
  staffName: string;
  documentType: string;
  documentName: string;
  expiryDate: string;
  daysUntil: number;
  severity: 'critical' | 'warning' | 'info';
}

export interface NotificationResult {
  success: boolean;
  type: 'birthday' | 'expiry' | 'compliance';
  sentTo: string;
  count: number;
  message: string;
}

/**
 * Staff Notification Service Class
 */
export class StaffNotificationService {
  /**
   * Send birthday reminder emails
   */
  static async sendBirthdayReminders(daysAhead: number = 7): Promise<NotificationResult> {
    if (!notificationConfig.enabled) {
      return {
        success: false,
        type: 'birthday',
        sentTo: '',
        count: 0,
        message: 'Staff alerts are disabled',
      };
    }

    try {
      // Get upcoming birthdays
      const birthdays = await this.getUpcomingBirthdays(daysAhead);

      if (birthdays.length === 0) {
        log.info('No upcoming birthdays to notify', { daysAhead }, 'staffNotifications');
        return {
          success: true,
          type: 'birthday',
          sentTo: notificationConfig.defaultRecipient,
          count: 0,
          message: 'No upcoming birthdays',
        };
      }

      // Format birthday list for email
      const birthdayList = birthdays.map((b) => {
        const dateStr = formatDisplayDateShort(b.dateOfBirth);
        const daysText = b.daysUntil === 0 ? '🎂 TODAY!' :
                        b.daysUntil === 1 ? 'Tomorrow' :
                        `In ${b.daysUntil} days`;
        return `• ${b.name} - Turning ${b.age} on ${dateStr} (${daysText})${b.department ? ` - ${b.department}` : ''}`;
      }).join('\n');

      const todayBirthdays = birthdays.filter(b => b.daysUntil === 0);
      const subject = todayBirthdays.length > 0
        ? `🎂 Birthday Alert: ${todayBirthdays.map(b => b.name).join(', ')} celebrating today!`
        : `📅 Upcoming Birthdays (Next ${daysAhead} days)`;

      const emailContent = {
        to: notificationConfig.defaultRecipient,
        subject,
        body: `
Staff Birthday Reminder
=======================

${birthdays.length} staff member${birthdays.length > 1 ? 's have' : ' has'} birthdays in the next ${daysAhead} days:

${birthdayList}

---
This is an automated reminder from FibreFlow HR.
        `.trim(),
        data: { birthdays, daysAhead },
      };

      await this.sendEmail(emailContent);
      await this.logNotification('birthday', emailContent);

      log.info('Birthday reminders sent', { count: birthdays.length }, 'staffNotifications');

      return {
        success: true,
        type: 'birthday',
        sentTo: notificationConfig.defaultRecipient,
        count: birthdays.length,
        message: `Sent reminder for ${birthdays.length} upcoming birthday(s)`,
      };
    } catch (error) {
      log.error('Failed to send birthday reminders', { error }, 'staffNotifications');
      return {
        success: false,
        type: 'birthday',
        sentTo: '',
        count: 0,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Send document expiry alerts
   */
  static async sendExpiryAlerts(daysAhead: number = 30): Promise<NotificationResult> {
    if (!notificationConfig.enabled) {
      return {
        success: false,
        type: 'expiry',
        sentTo: '',
        count: 0,
        message: 'Staff alerts are disabled',
      };
    }

    try {
      const expiringDocs = await this.getExpiringDocuments(daysAhead);

      if (expiringDocs.length === 0) {
        log.info('No expiring documents to notify', { daysAhead }, 'staffNotifications');
        return {
          success: true,
          type: 'expiry',
          sentTo: notificationConfig.defaultRecipient,
          count: 0,
          message: 'No expiring documents',
        };
      }

      // Group by severity
      const critical = expiringDocs.filter(d => d.severity === 'critical');
      const warnings = expiringDocs.filter(d => d.severity === 'warning');
      const info = expiringDocs.filter(d => d.severity === 'info');

      const formatDoc = (d: ExpiryAlert) => {
        const icon = d.severity === 'critical' ? '🔴' : d.severity === 'warning' ? '🟡' : '🟢';
        const dateStr = formatDisplayDate(d.expiryDate);
        const daysText = d.daysUntil < 0 ? `EXPIRED ${Math.abs(d.daysUntil)} days ago` :
                        d.daysUntil === 0 ? 'EXPIRES TODAY' :
                        `${d.daysUntil} days`;
        return `${icon} ${d.staffName} - ${d.documentName} (${dateStr}, ${daysText})`;
      };

      let body = `
Document Expiry Alert
=====================

${expiringDocs.length} document${expiringDocs.length > 1 ? 's' : ''} expiring within ${daysAhead} days:
`;

      if (critical.length > 0) {
        body += `
🔴 CRITICAL (Expired or <7 days):
${critical.map(formatDoc).join('\n')}
`;
      }

      if (warnings.length > 0) {
        body += `
🟡 WARNING (7-30 days):
${warnings.map(formatDoc).join('\n')}
`;
      }

      if (info.length > 0) {
        body += `
🟢 INFO (>30 days):
${info.map(formatDoc).join('\n')}
`;
      }

      body += `
---
Please ensure affected staff members renew their documents before expiry.
This is an automated reminder from FibreFlow HR.
`;

      const subject = critical.length > 0
        ? `🚨 URGENT: ${critical.length} Document(s) Expired or Expiring Soon`
        : `📋 Document Expiry Alert: ${expiringDocs.length} document(s) expiring`;

      const emailContent = {
        to: notificationConfig.defaultRecipient,
        subject,
        body: body.trim(),
        data: { expiringDocs, daysAhead },
      };

      await this.sendEmail(emailContent);
      await this.logNotification('expiry', emailContent);

      log.info('Expiry alerts sent', { count: expiringDocs.length, critical: critical.length }, 'staffNotifications');

      return {
        success: true,
        type: 'expiry',
        sentTo: notificationConfig.defaultRecipient,
        count: expiringDocs.length,
        message: `Sent alert for ${expiringDocs.length} expiring document(s), ${critical.length} critical`,
      };
    } catch (error) {
      log.error('Failed to send expiry alerts', { error }, 'staffNotifications');
      return {
        success: false,
        type: 'expiry',
        sentTo: '',
        count: 0,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Send weekly compliance summary
   */
  static async sendComplianceSummary(): Promise<NotificationResult> {
    if (!notificationConfig.enabled) {
      return {
        success: false,
        type: 'compliance',
        sentTo: '',
        count: 0,
        message: 'Staff alerts are disabled',
      };
    }

    try {
      const stats = await this.getComplianceStats();

      const body = `
Weekly Staff Compliance Summary
==============================

Overview:
• Total Active Staff: ${stats.totalStaff}
• Compliance Rate: ${stats.compliancePercentage}%

Document Verification Status:
• Verified SA ID: ${stats.withVerifiedId} (${Math.round((stats.withVerifiedId / stats.totalStaff) * 100)}%)
• Verified Passport: ${stats.withVerifiedPassport} (${Math.round((stats.withVerifiedPassport / stats.totalStaff) * 100)}%)
• Verified License: ${stats.withVerifiedLicense} (${Math.round((stats.withVerifiedLicense / stats.totalStaff) * 100)}%)
• Verified Bank Details: ${stats.withVerifiedBankDetails} (${Math.round((stats.withVerifiedBankDetails / stats.totalStaff) * 100)}%)
• Has Date of Birth: ${stats.withDob} (${Math.round((stats.withDob / stats.totalStaff) * 100)}%)

${stats.missingDocuments.length > 0 ? `
Staff with Missing Documents (showing first 20):
${stats.missingDocuments.slice(0, 20).map(s => `• ${s.staffName}: Missing ${s.missingTypes.join(', ')}`).join('\n')}
${stats.missingDocuments.length > 20 ? `\n... and ${stats.missingDocuments.length - 20} more` : ''}
` : 'All staff have complete documentation! 🎉'}

---
This weekly summary is generated automatically by FibreFlow HR.
      `.trim();

      const emailContent = {
        to: notificationConfig.defaultRecipient,
        subject: `📊 Weekly Staff Compliance Report - ${stats.compliancePercentage}% Compliant`,
        body,
        data: stats,
      };

      await this.sendEmail(emailContent);
      await this.logNotification('compliance', emailContent);

      log.info('Compliance summary sent', { complianceRate: stats.compliancePercentage }, 'staffNotifications');

      return {
        success: true,
        type: 'compliance',
        sentTo: notificationConfig.defaultRecipient,
        count: 1,
        message: `Sent compliance summary (${stats.compliancePercentage}% compliant)`,
      };
    } catch (error) {
      log.error('Failed to send compliance summary', { error }, 'staffNotifications');
      return {
        success: false,
        type: 'compliance',
        sentTo: '',
        count: 0,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Get upcoming birthdays
   */
  private static async getUpcomingBirthdays(days: number): Promise<BirthdayAlert[]> {
    const results = await sql`
      WITH birthday_calc AS (
        SELECT
          id,
          name,
          email,
          date_of_birth,
          department,
          position,
          CASE
            WHEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,
                           EXTRACT(MONTH FROM date_of_birth)::int,
                           EXTRACT(DAY FROM date_of_birth)::int) >= CURRENT_DATE
            THEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,
                           EXTRACT(MONTH FROM date_of_birth)::int,
                           EXTRACT(DAY FROM date_of_birth)::int)
            ELSE make_date((EXTRACT(YEAR FROM CURRENT_DATE) + 1)::int,
                           EXTRACT(MONTH FROM date_of_birth)::int,
                           EXTRACT(DAY FROM date_of_birth)::int)
          END AS next_birthday,
          EXTRACT(YEAR FROM age(date_of_birth))::int AS current_age
        FROM staff
        WHERE date_of_birth IS NOT NULL
          AND (status = 'active' OR is_active = true)
      )
      SELECT
        id,
        name,
        email,
        date_of_birth,
        department,
        position,
        (next_birthday - CURRENT_DATE) AS days_until,
        current_age +
          CASE WHEN next_birthday > make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,
                                              EXTRACT(MONTH FROM date_of_birth)::int,
                                              EXTRACT(DAY FROM date_of_birth)::int)
               THEN 1 ELSE 0 END AS age_on_birthday
      FROM birthday_calc
      WHERE (next_birthday - CURRENT_DATE) BETWEEN 0 AND ${days}
      ORDER BY days_until ASC
    `;

    return results.map(r => ({
      id: r.id as string,
      name: r.name as string,
      email: r.email as string | null,
      dateOfBirth: r.date_of_birth as string,
      department: r.department as string | null,
      position: r.position as string | null,
      daysUntil: parseInt(r.days_until as string),
      age: parseInt(r.age_on_birthday as string),
    }));
  }

  /**
   * Get expiring documents
   */
  private static async getExpiringDocuments(days: number): Promise<ExpiryAlert[]> {
    const alerts: ExpiryAlert[] = [];

    // Check staff table for expiring documents
    const staffExpiry = await sql`
      SELECT
        id,
        name,
        drivers_license_expiry,
        passport_expiry,
        medical_certificate_expiry,
        police_clearance_expiry,
        work_permit_expiry
      FROM staff
      WHERE (status = 'active' OR is_active = true)
        AND (
          (drivers_license_expiry IS NOT NULL AND drivers_license_expiry <= CURRENT_DATE + ${days})
          OR (passport_expiry IS NOT NULL AND passport_expiry <= CURRENT_DATE + ${days})
          OR (medical_certificate_expiry IS NOT NULL AND medical_certificate_expiry <= CURRENT_DATE + ${days})
          OR (police_clearance_expiry IS NOT NULL AND police_clearance_expiry <= CURRENT_DATE + ${days})
          OR (work_permit_expiry IS NOT NULL AND work_permit_expiry <= CURRENT_DATE + ${days})
        )
    `;

    for (const staff of staffExpiry) {
      const expiryFields = [
        { field: 'drivers_license_expiry', type: 'drivers_license', name: "Driver's License" },
        { field: 'passport_expiry', type: 'passport', name: 'Passport' },
        { field: 'medical_certificate_expiry', type: 'medical', name: 'Medical Certificate' },
        { field: 'police_clearance_expiry', type: 'police_clearance', name: 'Police Clearance' },
        { field: 'work_permit_expiry', type: 'work_permit', name: 'Work Permit' },
      ];

      for (const { field, type, name } of expiryFields) {
        const expiryDate = staff[field] as string | null;
        if (expiryDate) {
          const daysUntil = Math.ceil(
            (new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          );

          if (daysUntil <= days) {
            let severity: 'critical' | 'warning' | 'info' = 'info';
            if (daysUntil < 0) severity = 'critical';
            else if (daysUntil <= 7) severity = 'critical';
            else if (daysUntil <= 30) severity = 'warning';

            alerts.push({
              id: `${staff.id}-${field}`,
              staffId: staff.id as string,
              staffName: staff.name as string,
              documentType: type,
              documentName: name,
              expiryDate,
              daysUntil,
              severity,
            });
          }
        }
      }
    }

    return alerts.sort((a, b) => a.daysUntil - b.daysUntil);
  }

  /**
   * Get compliance stats
   */
  private static async getComplianceStats() {
    const [countResult] = await sql`
      SELECT COUNT(*) as total FROM staff WHERE status = 'active' OR is_active = true
    `;
    const totalStaff = parseInt(countResult.total as string);

    const [statsResult] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE sa_id_number IS NOT NULL) as with_id,
        COUNT(*) FILTER (WHERE passport_number IS NOT NULL) as with_passport,
        COUNT(*) FILTER (WHERE drivers_license_number IS NOT NULL) as with_license,
        COUNT(*) FILTER (WHERE bank_account_number IS NOT NULL) as with_bank,
        COUNT(*) FILTER (WHERE date_of_birth IS NOT NULL) as with_dob
      FROM staff
      WHERE status = 'active' OR is_active = true
    `;

    const missingDocs = await sql`
      SELECT
        id,
        name,
        CASE WHEN sa_id_number IS NULL THEN 'SA ID' END as missing_id,
        CASE WHEN bank_account_number IS NULL THEN 'Bank Details' END as missing_bank,
        CASE WHEN date_of_birth IS NULL THEN 'Date of Birth' END as missing_dob
      FROM staff
      WHERE (status = 'active' OR is_active = true)
        AND (sa_id_number IS NULL OR bank_account_number IS NULL OR date_of_birth IS NULL)
      LIMIT 50
    `;

    const missingDocuments = missingDocs.map(row => {
      const missingTypes: string[] = [];
      if (row.missing_id) missingTypes.push(row.missing_id as string);
      if (row.missing_bank) missingTypes.push(row.missing_bank as string);
      if (row.missing_dob) missingTypes.push(row.missing_dob as string);
      return {
        staffId: row.id as string,
        staffName: row.name as string,
        missingTypes,
      };
    });

    const withVerifiedId = parseInt(statsResult.with_id as string);
    const withVerifiedBank = parseInt(statsResult.with_bank as string);

    const compliancePercentage = totalStaff > 0
      ? Math.round(((withVerifiedId + withVerifiedBank) / (totalStaff * 2)) * 100)
      : 0;

    return {
      totalStaff,
      withVerifiedId,
      withVerifiedPassport: parseInt(statsResult.with_passport as string),
      withVerifiedLicense: parseInt(statsResult.with_license as string),
      withVerifiedBankDetails: withVerifiedBank,
      withDob: parseInt(statsResult.with_dob as string),
      missingDocuments,
      compliancePercentage,
    };
  }

  /**
   * Send email (via webhook or direct)
   */
  private static async sendEmail(emailData: {
    to: string;
    subject: string;
    body: string;
    data?: unknown;
  }): Promise<void> {
    const webhookUrl = process.env.EMAIL_WEBHOOK_URL;

    if (webhookUrl) {
      // Send via webhook (for integration with email service)
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: {
              email: notificationConfig.fromEmail,
              name: notificationConfig.fromName,
            },
            to: emailData.to,
            subject: emailData.subject,
            text: emailData.body,
            timestamp: new Date().toISOString(),
          }),
        });
        log.info('Email sent via webhook', { to: emailData.to, subject: emailData.subject }, 'staffNotifications');
      } catch (error) {
        log.error('Failed to send email via webhook', { error }, 'staffNotifications');
        throw error;
      }
    } else {
      // Log email for development/testing
      log.info('Email notification (no webhook configured)', {
        from: notificationConfig.fromEmail,
        to: emailData.to,
        subject: emailData.subject,
        bodyPreview: emailData.body.substring(0, 200) + '...',
      }, 'staffNotifications');
    }
  }

  /**
   * Log notification to database
   */
  private static async logNotification(
    type: string,
    emailData: { to: string; subject: string; body: string; data?: unknown }
  ): Promise<void> {
    try {
      await sql`
        INSERT INTO staff_notifications (
          notification_type,
          recipient_email,
          subject,
          message,
          metadata,
          sent_at
        ) VALUES (
          ${type},
          ${emailData.to},
          ${emailData.subject},
          ${emailData.body},
          ${JSON.stringify(emailData.data || {})},
          NOW()
        )
      `;
    } catch (error) {
      // Table might not exist yet, log warning but don't fail
      log.warn('Could not log notification to database', { error, type }, 'staffNotifications');
    }
  }
}

export default StaffNotificationService;
