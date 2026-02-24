/**
 * Field App — Task by ID
 * Phase 1: GET wired to real DB with staff JOIN (replaces mock data)
 * Phase 2 (future): PATCH status updates, DELETE
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
      log.error('FieldTasksApi', `Error fetching task ${id}: ${error}`);
      return apiResponse.internalError(res, error);
    }

  // ─── PATCH /api/field/tasks/[id] ─────────────────────────────────────────
  } else if (req.method === 'PATCH') {
    // Phase 2: DB update — stub for now
    const updates = req.body;
    log.info('FieldTasksApi', `PATCH task ${id} (stub) — Phase 2 pending`);
    return res.status(200).json({
      message: 'Task updated successfully',
      task: { id, ...updates, updatedAt: new Date().toISOString() },
    });

  // ─── DELETE /api/field/tasks/[id] ────────────────────────────────────────
  } else if (req.method === 'DELETE') {
    // Phase 2: DB delete — stub for now
    log.info('FieldTasksApi', `DELETE task ${id} (stub) — Phase 2 pending`);
    return res.status(200).json({ message: 'Task deleted successfully' });

  } else {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PATCH', 'DELETE']);
  }
}

export default withAuth(handler);
