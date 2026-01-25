/**
 * OLT Report Investigation Resolve API
 *
 * POST: Resolve an investigation record with a resolution type and notes
 *       or escalate to an admin user
 *
 * Request body:
 * - recordId: string (required) - The olt_mismatch_records.id
 * - action: 'resolve' | 'escalate' (required)
 *
 * For action: 'resolve':
 * - resolutionType: string (required)
 *   - 'manually_fixed' - Fixed manually in 1Map
 *   - 'closed_invalid' - Invalid record/data
 *   - 'closed_no_data' - Missing data, cannot fix
 *   - 'closed_false_positive' - Not a real mismatch
 * - notes: string (optional) - Resolution notes
 *
 * For action: 'escalate':
 * - escalateTo: string (required) - User ID of admin to escalate to
 * - notes: string (optional) - Escalation notes
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logActivity } from '@/modules/activate/services/activityLogService';
import { sendEmailNotification } from '@/lib/email';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const VALID_RESOLUTION_TYPES = [
  'manually_fixed',
  'closed_invalid',
  'closed_no_data',
  'closed_false_positive',
];

interface ResolveRequest {
  recordId: string;
  action: 'resolve' | 'escalate';
  resolutionType?: string;
  escalateTo?: string;
  notes?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const client = await pool.connect();
  const user = getAuthUser(req);

  try {
    const { recordId, action, resolutionType, escalateTo, notes } = req.body as ResolveRequest;

    // Validate required fields
    if (!recordId) {
      return apiResponse.badRequest(res, 'recordId is required');
    }
    if (!action || !['resolve', 'escalate'].includes(action)) {
      return apiResponse.badRequest(res, 'action must be "resolve" or "escalate"');
    }

    // Get the record first
    const recordResult = await client.query(
      `SELECT m.*, i.filename as import_filename
       FROM olt_mismatch_records m
       LEFT JOIN olt_report_imports i ON m.import_id = i.id
       WHERE m.id = $1`,
      [recordId]
    );

    if (recordResult.rows.length === 0) {
      return apiResponse.notFound(res, 'Record', recordId);
    }

    const record = recordResult.rows[0];
    const drNumber = record.drop_number;

    if (action === 'resolve') {
      // Validate resolution type
      if (!resolutionType || !VALID_RESOLUTION_TYPES.includes(resolutionType)) {
        return apiResponse.badRequest(
          res,
          `resolutionType must be one of: ${VALID_RESOLUTION_TYPES.join(', ')}`
        );
      }

      // Update the record
      await client.query(
        `UPDATE olt_mismatch_records
         SET fix_status = 'resolved',
             resolution_type = $1,
             resolution_notes = $2,
             resolved_at = NOW(),
             resolved_by = $3
         WHERE id = $4`,
        [resolutionType, notes || null, user?.id, recordId]
      );

      // Log to DR activity
      await logActivity(
        drNumber,
        'INVESTIGATION_RESOLVED',
        {
          details: `OLT mismatch investigation resolved as: ${resolutionType}`,
          resolutionType,
          notes: notes || null,
          source: 'olt_report',
        },
        user?.id || 'system'
      );

      log.info('OltReportResolve', 'Investigation resolved', {
        recordId,
        drNumber,
        resolutionType,
        resolvedBy: user?.email,
      });

      return apiResponse.success(res, {
        success: true,
        action: 'resolved',
        recordId,
        drNumber,
        resolutionType,
      });
    }

    if (action === 'escalate') {
      // Validate escalation target
      if (!escalateTo) {
        return apiResponse.badRequest(res, 'escalateTo is required for escalation');
      }

      // Verify the target user exists and is an admin
      const targetUserResult = await client.query(
        `SELECT id, email, first_name, last_name, role,
                COALESCE(first_name || ' ' || last_name, first_name, last_name, email) as name
         FROM users WHERE id = $1`,
        [escalateTo]
      );

      if (targetUserResult.rows.length === 0) {
        return apiResponse.notFound(res, 'Target user', escalateTo);
      }

      const targetUser = targetUserResult.rows[0];

      if (targetUser.role !== 'admin') {
        return apiResponse.badRequest(res, 'Can only escalate to admin users');
      }

      // Update the record
      await client.query(
        `UPDATE olt_mismatch_records
         SET fix_status = 'escalated',
             resolution_type = 'escalated',
             resolution_notes = $1,
             escalated_to = $2,
             escalated_at = NOW(),
             escalated_by = $3
         WHERE id = $4`,
        [notes || null, escalateTo, user?.id, recordId]
      );

      // Log to DR activity
      await logActivity(
        drNumber,
        'ESCALATED_TO_ADMIN',
        {
          details: `OLT mismatch investigation escalated to ${targetUser.name || targetUser.email}`,
          escalatedTo: targetUser.email,
          notes: notes || null,
          source: 'olt_report',
        },
        user?.id || 'system'
      );

      // Send email notification to the admin
      try {
        await sendEmailNotification({
          to: targetUser.email,
          subject: `OLT Report: Investigation Escalated - ${drNumber}`,
          template: 'escalation',
          data: {
            recipientName: targetUser.name || targetUser.email,
            drNumber,
            oltSerial: record.olt_serial || 'N/A',
            wrongSerial: record.wrong_onemap_serial || 'N/A',
            escalatedBy: user?.email || 'Unknown',
            notes: notes || 'No additional notes',
            actionUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app'}/system/data-management/olt-report?view=escalations`,
          },
        });

        log.info('OltReportResolve', 'Escalation email sent', {
          recordId,
          drNumber,
          escalatedTo: targetUser.email,
        });
      } catch (emailError) {
        // Log but don't fail the request if email fails
        log.error('OltReportResolve', 'Failed to send escalation email', { emailError });
      }

      log.info('OltReportResolve', 'Investigation escalated', {
        recordId,
        drNumber,
        escalatedTo: targetUser.email,
        escalatedBy: user?.email,
      });

      return apiResponse.success(res, {
        success: true,
        action: 'escalated',
        recordId,
        drNumber,
        escalatedTo: targetUser.email,
      });
    }

    return apiResponse.badRequest(res, 'Invalid action');
  } catch (error) {
    log.error('OltReportResolve', 'API error', { error });
    return apiResponse.internalError(res, error);
  } finally {
    client.release();
  }
}

export default withAuth(withRole('manager')(handler));
