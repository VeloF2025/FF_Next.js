/**
 * Staff Alerts Notification API
 * POST /api/staff/send-alerts - Trigger staff alert notifications
 *
 * Query params:
 * - type: 'birthdays' | 'expiry' | 'compliance' | 'all' (default: 'all')
 * - days: number of days to look ahead (default: varies by type)
 *
 * This endpoint can be called by a cron job to send automated notifications.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { StaffNotificationService, NotificationResult } from '@/services/staff/staffNotificationService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('StaffSendAlertsAPI');

interface SendAlertsResponse {
  success: boolean;
  results: NotificationResult[];
  message: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SendAlertsResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // Optional: Add API key authentication for cron jobs
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const expectedKey = process.env.STAFF_ALERTS_API_KEY;

  if (expectedKey && apiKey !== expectedKey) {
    logger.warn('Unauthorized send-alerts attempt', { providedKey: apiKey ? 'provided' : 'missing' });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const type = (req.query.type as string) || (req.body?.type as string) || 'all';
    const birthdayDays = parseInt(req.query.birthdayDays as string || req.body?.birthdayDays) || 7;
    const expiryDays = parseInt(req.query.expiryDays as string || req.body?.expiryDays) || 30;

    const results: NotificationResult[] = [];

    // Send birthday reminders
    if (type === 'all' || type === 'birthdays') {
      const birthdayResult = await StaffNotificationService.sendBirthdayReminders(birthdayDays);
      results.push(birthdayResult);
    }

    // Send document expiry alerts
    if (type === 'all' || type === 'expiry') {
      const expiryResult = await StaffNotificationService.sendExpiryAlerts(expiryDays);
      results.push(expiryResult);
    }

    // Send compliance summary (typically weekly)
    if (type === 'all' || type === 'compliance') {
      const complianceResult = await StaffNotificationService.sendComplianceSummary();
      results.push(complianceResult);
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    logger.info('Staff alerts sent', {
      type,
      successCount,
      failCount,
      results: results.map(r => ({ type: r.type, success: r.success, count: r.count })),
    });

    return res.status(200).json({
      success: failCount === 0,
      results,
      message: failCount === 0
        ? `Successfully sent ${successCount} notification type(s)`
        : `Sent ${successCount} notification(s), ${failCount} failed`,
    });
  } catch (error) {
    logger.error('Failed to send staff alerts', { error });
    return res.status(500).json({ error: 'Failed to send alerts' });
  }
}
