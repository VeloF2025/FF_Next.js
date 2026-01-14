/**
 * Fleet Check-In Reminders Cron Job
 * Sends daily and weekly check reminders to drivers
 *
 * Schedule: 0 7 * * 1-6 (7 AM Mon-Sat)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  getVehiclesNeedingDailyCheck,
  getVehiclesNeedingWeeklyCheck,
  markReminderSent,
  getCheckSchedule,
} from '@/modules/fleet/services/checkInService';
import type { CheckType } from '@/modules/fleet/types/check-in.types';

const sql = neon(process.env.DATABASE_URL!);

// WAHA WhatsApp API configuration
const WAHA_API_URL = process.env.WAHA_API_URL || 'http://100.96.203.105:3001';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';

// Resend Email API
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'noreply@fibreflow.app';

interface VehicleWithDriver {
  vehicleId: string;
  registration: string;
  make: string | null;
  model: string | null;
  driverId: string;
  driverName: string;
  driverEmail: string | null;
  driverPhone: string | null;
}

// Database row type (snake_case)
interface VehicleWithDriverRow {
  vehicle_id: string;
  registration: string;
  make: string | null;
  model: string | null;
  driver_id: string;
  driver_name: string;
  driver_email: string | null;
  driver_phone: string | null;
}

/**
 * Get vehicles with assigned drivers
 */
async function getVehiclesWithDrivers(): Promise<VehicleWithDriver[]> {
  const rows = await sql`
    SELECT
      v.id as vehicle_id,
      v.registration,
      v.make,
      v.model,
      s.id as driver_id,
      s.name as driver_name,
      s.email as driver_email,
      s.phone as driver_phone
    FROM fleet_vehicles v
    JOIN staff s ON s.id = v.assigned_driver_id
    WHERE v.status = 'active'
    AND v.assigned_driver_id IS NOT NULL
  ` as VehicleWithDriverRow[];

  return rows.map(r => ({
    vehicleId: r.vehicle_id,
    registration: r.registration,
    make: r.make,
    model: r.model,
    driverId: r.driver_id,
    driverName: r.driver_name,
    driverEmail: r.driver_email,
    driverPhone: r.driver_phone,
  }));
}

/**
 * Send WhatsApp reminder
 */
async function sendWhatsAppReminder(
  phone: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    // Format phone number (remove spaces, ensure country code)
    let formattedPhone = phone.replace(/\s+/g, '');
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '27' + formattedPhone.substring(1); // South Africa
    }
    if (!formattedPhone.startsWith('+')) {
      formattedPhone = '+' + formattedPhone;
    }

    const response = await fetch(`${WAHA_API_URL}/api/sendText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: WAHA_SESSION,
        chatId: `${formattedPhone.replace('+', '')}@c.us`,
        text: message,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    const data = await response.json();
    return { success: true, messageId: data.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send email reminder
 */
async function sendEmailReminder(
  email: string,
  subject: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!RESEND_API_KEY) {
    return { success: false, error: 'Resend API key not configured' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: email,
        subject,
        text: message,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    const data = await response.json();
    return { success: true, messageId: data.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Build reminder message
 */
function buildReminderMessage(
  checkType: CheckType,
  driverName: string,
  registration: string,
  make: string | null,
  model: string | null
): string {
  const vehicleDesc = [registration, make, model].filter(Boolean).join(' ');
  const checkUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app'}/fleet/check-in`;

  if (checkType === 'weekly') {
    return `Hi ${driverName},

It's Monday - time for your weekly vehicle inspection!

Vehicle: ${vehicleDesc}

Please complete the full pre-trip inspection checklist including:
- Exterior check (tyres, lights, mirrors)
- Interior check (seats, doors, seatbelts)
- Switch-on check (warning lights, horn)

Open FibreFlow to start: ${checkUrl}`;
  }

  return `Hi ${driverName},

Please complete your daily vehicle check for ${registration}.

Quick check required:
- Odometer photo
- Fuel gauge photo

Open FibreFlow: ${checkUrl}`;
}

/**
 * Log reminder to database
 */
async function logReminder(
  vehicleId: string,
  driverId: string,
  checkType: CheckType,
  channel: 'whatsapp' | 'email',
  messageId: string | null,
  status: 'sent' | 'failed'
): Promise<void> {
  await sql`
    INSERT INTO fleet_check_reminders (
      vehicle_id, driver_id, check_type, reminder_channel,
      message_id, delivery_status
    )
    VALUES (
      ${vehicleId}, ${driverId}, ${checkType}, ${channel},
      ${messageId}, ${status}
    )
  `;
}

/**
 * Send reminder to a driver (WhatsApp primary, Email fallback)
 */
async function sendReminder(
  vehicle: VehicleWithDriver,
  checkType: CheckType
): Promise<{ success: boolean; channel?: string }> {
  const message = buildReminderMessage(
    checkType,
    vehicle.driverName,
    vehicle.registration,
    vehicle.make,
    vehicle.model
  );

  // Try WhatsApp first
  if (vehicle.driverPhone) {
    const waResult = await sendWhatsAppReminder(vehicle.driverPhone, message);
    if (waResult.success) {
      await logReminder(
        vehicle.vehicleId,
        vehicle.driverId,
        checkType,
        'whatsapp',
        waResult.messageId || null,
        'sent'
      );
      await markReminderSent(vehicle.vehicleId, checkType);
      return { success: true, channel: 'whatsapp' };
    }
    log.warn('FleetReminders', `WhatsApp failed for ${vehicle.driverName}: ${waResult.error}`);
  }

  // Fallback to email
  if (vehicle.driverEmail) {
    const subject = checkType === 'weekly'
      ? `Weekly Vehicle Inspection Required - ${vehicle.registration}`
      : `Daily Vehicle Check Required - ${vehicle.registration}`;

    const emailResult = await sendEmailReminder(vehicle.driverEmail, subject, message);
    if (emailResult.success) {
      await logReminder(
        vehicle.vehicleId,
        vehicle.driverId,
        checkType,
        'email',
        emailResult.messageId || null,
        'sent'
      );
      await markReminderSent(vehicle.vehicleId, checkType);
      return { success: true, channel: 'email' };
    }
    log.warn('FleetReminders', `Email failed for ${vehicle.driverName}: ${emailResult.error}`);
  }

  // Both failed
  await logReminder(
    vehicle.vehicleId,
    vehicle.driverId,
    checkType,
    'whatsapp',
    null,
    'failed'
  );
  return { success: false };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify cron secret (optional security)
  const cronSecret = req.headers['x-cron-secret'];
  if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
    return apiResponse.unauthorized(res, 'Invalid cron secret');
  }

  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon

  // Skip Sundays
  if (dayOfWeek === 0) {
    return apiResponse.success(res, { message: 'Sunday - no reminders sent', sent: 0 });
  }

  log.info('FleetReminders', `Starting reminder job for ${today.toISOString().split('T')[0]}`);

  try {
    const vehicles = await getVehiclesWithDrivers();
    log.info('FleetReminders', `Found ${vehicles.length} vehicles with assigned drivers`);

    let sentCount = 0;
    let failedCount = 0;
    const results: Array<{
      vehicle: string;
      driver: string;
      checkType: CheckType;
      success: boolean;
      channel?: string;
    }> = [];

    // Monday = Weekly check day
    if (dayOfWeek === 1) {
      const needsWeekly = await getVehiclesNeedingWeeklyCheck();
      log.info('FleetReminders', `${needsWeekly.length} vehicles need weekly check`);

      for (const vehicle of vehicles) {
        if (needsWeekly.includes(vehicle.vehicleId)) {
          const schedule = await getCheckSchedule(vehicle.vehicleId);
          if (!schedule?.reminderSentWeekly) {
            const result = await sendReminder(vehicle, 'weekly');
            results.push({
              vehicle: vehicle.registration,
              driver: vehicle.driverName,
              checkType: 'weekly',
              success: result.success,
              channel: result.channel,
            });
            if (result.success) sentCount++;
            else failedCount++;
          }
        }
      }
    }

    // Daily check for remaining vehicles
    const needsDaily = await getVehiclesNeedingDailyCheck();
    log.info('FleetReminders', `${needsDaily.length} vehicles need daily check`);

    for (const vehicle of vehicles) {
      if (needsDaily.includes(vehicle.vehicleId)) {
        const schedule = await getCheckSchedule(vehicle.vehicleId);
        if (!schedule?.reminderSentDaily) {
          const result = await sendReminder(vehicle, 'daily');
          results.push({
            vehicle: vehicle.registration,
            driver: vehicle.driverName,
            checkType: 'daily',
            success: result.success,
            channel: result.channel,
          });
          if (result.success) sentCount++;
          else failedCount++;
        }
      }
    }

    log.info('FleetReminders', `Reminder job complete: ${sentCount} sent, ${failedCount} failed`);

    return apiResponse.success(res, {
      date: today.toISOString().split('T')[0],
      sent: sentCount,
      failed: failedCount,
      results,
    });
  } catch (error) {
    log.error('FleetReminders', `Reminder job failed: ${error}`);
    return apiResponse.internalError(res, error);
  }
}

export const config = {
  api: {
    bodyParser: false, // No body needed for GET
  },
};
