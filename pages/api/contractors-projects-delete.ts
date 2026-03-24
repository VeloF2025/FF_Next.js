/**
 * Delete Contractor Project Assignment API
 * DELETE /api/contractors-projects-delete?id=xxx
 *
 * Soft deletes a contractor assignment from a project
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return apiResponse.methodNotAllowed(res, req.method!, ['DELETE']);
  }

  try {
    const { id } = req.query;
    const { removedBy, removalReason, hardDelete } = req.body;

    if (!id || typeof id !== 'string') {
      return apiResponse.badRequest(res, 'Assignment ID is required');
    }

    // Check if assignment exists
    const existing = await sql`
      SELECT id FROM contractor_projects WHERE id = ${id}
    `;

    if (existing.length === 0) {
      return apiResponse.notFound(res, 'Assignment not found');
    }

    if (hardDelete === true) {
      // Hard delete (permanent removal)
      await sql`
        DELETE FROM contractor_projects WHERE id = ${id}
      `;

      return res.status(200).json({
        success: true,
        message: 'Assignment permanently deleted'
      });
    } else {
      // Soft delete (mark as inactive and removed)
      const [updated] = await sql`
        UPDATE contractor_projects
        SET
          is_active = false,
          assignment_status = 'removed',
          removal_reason = ${removalReason || 'No reason provided'},
          removed_by = ${removedBy || null},
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;

      return res.status(200).json({
        success: true,
        data: mapDbToAssignment(updated),
        message: 'Assignment removed successfully'
      });
    }

  } catch (error: any) {
    log.error('Error deleting contractor assignment', { error });
    return res.status(500).json({
      error: 'Failed to delete assignment',
      message: error.message
    });
  }
}

function mapDbToAssignment(row: any) {
  return {
    id: row.id,
    contractorId: row.contractor_id,
    projectId: row.project_id,
    role: row.role,
    assignmentStatus: row.assignment_status,
    startDate: new Date(row.start_date),
    endDate: row.end_date ? new Date(row.end_date) : undefined,
    actualEndDate: row.actual_end_date ? new Date(row.actual_end_date) : undefined,
    workloadPercentage: row.workload_percentage,
    estimatedHours: row.estimated_hours,
    actualHours: row.actual_hours,
    performanceRating: row.performance_rating,
    qualityScore: row.quality_score,
    safetyIncidents: row.safety_incidents,
    contractValue: row.contract_value,
    paymentTerms: row.payment_terms,
    isPrimaryContractor: row.is_primary_contractor,
    isActive: row.is_active,
    notes: row.notes,
    removalReason: row.removal_reason,
    assignedBy: row.assigned_by,
    removedBy: row.removed_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

export default withAuth(handler);
