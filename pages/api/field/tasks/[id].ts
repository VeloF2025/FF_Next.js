/**
 * Field App — Task by ID
 * Phase 1: GET wired to real DB with staff JOIN
 * Phase 2: PATCH status updates + metadata merge (notes, photos, qualityCheck)
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = createLoggedSql(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Task ID is required');
  }

  // ─── GET /api/field/tasks/[id] ───────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT
          t.id,
          t.title,
          t.description,
          t.category,
          t.priority,
          t.status,
          t.assigned_to,
          t.project_id,
          t.start_date,
          t.due_date,
          t.estimated_hours,
          t.metadata,
          t.created_at,
          t.updated_at,
          u.first_name,
          u.last_name,
          p.project_name,
          p.location AS project_location
        FROM tasks t
        LEFT JOIN users u ON t.assigned_to = u.id
        LEFT JOIN projects p ON t.project_id = p.id
        WHERE t.id = ${id}
        LIMIT 1
      `;

      if (!rows.length) {
        return apiResponse.error(res, ErrorCode.NOT_FOUND, `Task ${id} not found`);
      }

      const task = rows[0] as Record<string, unknown>;
      const metadata = (task.metadata as Record<string, unknown>) || {};
      const location = (metadata.location as Record<string, unknown>) || {};

      const result = {
        id: task.id,
        title: task.title,
        description: task.description || '',
        type: (task.category as string) || 'installation',
        priority: (task.priority as string) || 'medium',
        status: (task.status as string) || 'pending',
        assignedTo: task.assigned_to || '',
        technicianName: task.first_name && task.last_name
          ? `${task.first_name} ${task.last_name}`.trim()
          : 'Unassigned',
        location: {
          address: (location.address as string) || (task.project_location as string) || 'No address specified',
          coordinates: (location.latitude && location.longitude)
            ? { lat: Number(location.latitude), lng: Number(location.longitude) }
            : { lat: -26.2041, lng: 28.0473 },
        },
        scheduledDate: (task.start_date as string) || (task.due_date as string) || new Date().toISOString(),
        estimatedDuration: task.estimated_hours ? Number(task.estimated_hours) : 4,
        materials: (metadata.equipment as unknown[]) || [],
        notes: (metadata.notes as unknown[]) || [],
        photos: (metadata.photos as unknown[]) || [],
        customerInfo: metadata.customerInfo || null,
        workOrder: metadata.workOrder || null,
        qualityCheck: metadata.qualityCheck || null,
        syncStatus: (metadata.syncStatus as string) || 'synced',
        offline: metadata.offlineEdits ? true : false,
        createdAt: (task.created_at as string) || new Date().toISOString(),
        updatedAt: (task.updated_at as string) || new Date().toISOString(),
      };

      return apiResponse.success(res, result);
    } catch (error) {
      log.error(`Error fetching task ${id}: ${error}`, undefined, 'FieldTasksApi');
      return apiResponse.internalError(res, error);
    }

  // ─── PATCH /api/field/tasks/[id] ─────────────────────────────────────────
  } else if (req.method === 'PATCH') {
    const { status, notes, photos, qualityCheck, syncStatus, offlineEdits } = req.body as {
      status?: string;
      notes?: unknown[];
      photos?: unknown[];
      qualityCheck?: Record<string, unknown>;
      syncStatus?: string;
      offlineEdits?: boolean;
    };

    const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
    if (status && !VALID_STATUSES.includes(status)) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST,
        `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    try {
      // Fetch existing task first (need current metadata to merge)
      const existing = await sql`SELECT status, metadata FROM tasks WHERE id = ${id} LIMIT 1`;
      if (!existing.length) {
        return apiResponse.error(res, ErrorCode.NOT_FOUND, `Task ${id} not found`);
      }

      const currentMeta = (existing[0]!.metadata as Record<string, unknown>) || {};

      // Build merged metadata (deep merge — don't replace, extend)
      const updatedMeta: Record<string, unknown> = {
        ...currentMeta,
        ...(notes !== undefined && { notes }),
        ...(photos !== undefined && { photos }),
        ...(qualityCheck !== undefined && { qualityCheck }),
        ...(syncStatus !== undefined && { syncStatus }),
        ...(offlineEdits !== undefined && { offlineEdits }),
      };

      // Apply updates — only touch columns that changed
      const updatedRows = await sql`
        UPDATE tasks SET
          status     = COALESCE(${status ?? null}, status),
          metadata   = ${JSON.stringify(updatedMeta)}::jsonb,
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, status, updated_at
      `;

      if (!updatedRows.length) {
        return apiResponse.error(res, ErrorCode.NOT_FOUND, `Task ${id} not found`);
      }

      const updated = updatedRows[0]!;
      log.info(`Task ${id} updated: status=${updated.status}`, undefined, 'FieldTasksApi');

      return apiResponse.success(res, {
        id: updated.id,
        status: updated.status,
        updatedAt: updated.updated_at,
        syncStatus: syncStatus || (currentMeta.syncStatus as string) || 'synced',
      }, 'Task updated successfully');
    } catch (error) {
      log.error(`Error updating task ${id}: ${error}`, undefined, 'FieldTasksApi');
      return apiResponse.internalError(res, error);
    }

  // ─── DELETE /api/field/tasks/[id] ────────────────────────────────────────
  } else if (req.method === 'DELETE') {
    // Phase 2: DB delete — stub (field app doesn't delete tasks, just cancels)
    log.info(`DELETE task ${id} — use PATCH status=cancelled instead`, undefined, 'FieldTasksApi');
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED,
      'Tasks cannot be deleted. Use PATCH with status=cancelled.');

  } else {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PATCH', 'DELETE']);
  }
}

export default withAuth(handler);
