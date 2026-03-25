/**
 * Update Contractor Project Assignment API
 * PUT /api/contractors-projects-update?id=xxx
 *
 * Updates an existing contractor assignment to a project
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return apiResponse.methodNotAllowed(res, req.method!, ['PUT']);
  }

  try {
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return apiResponse.badRequest(res, 'Assignment ID is required');
    }

    const {
      role,
      assignmentStatus,
      startDate,
      endDate,
      actualEndDate,
      workloadPercentage,
      estimatedHours,
      actualHours,
      performanceRating,
      qualityScore,
      safetyIncidents,
      contractValue,
      paymentTerms,
      isPrimaryContractor,
      isActive,
      notes,
      removalReason
    } = req.body;

    // Check if assignment exists
    const existing = await sql`
      SELECT id FROM contractor_projects WHERE id = ${id}
    `;

    if (existing.length === 0) {
      return apiResponse.notFound(res, 'Assignment not found');
    }

    // Fetch current assignment
    const [current] = await sql`
      SELECT id, contractor_id, project_id, role, assignment_status,
             start_date, end_date, actual_end_date, workload_percentage,
             estimated_hours, actual_hours, performance_rating, quality_score,
             safety_incidents, contract_value, payment_terms,
             is_primary_contractor, is_active, notes, removal_reason,
             assigned_by, removed_by, created_at, updated_at
      FROM contractor_projects WHERE id = ${id}
    `;

    // Use provided values or keep current ones
    const updatedData = {
      role: role !== undefined ? role : current.role,
      assignmentStatus: assignmentStatus !== undefined ? assignmentStatus : current.assignment_status,
      startDate: startDate !== undefined ? startDate : current.start_date,
      endDate: endDate !== undefined ? endDate : current.end_date,
      actualEndDate: actualEndDate !== undefined ? actualEndDate : current.actual_end_date,
      workloadPercentage: workloadPercentage !== undefined ? workloadPercentage : current.workload_percentage,
      estimatedHours: estimatedHours !== undefined ? estimatedHours : current.estimated_hours,
      actualHours: actualHours !== undefined ? actualHours : current.actual_hours,
      performanceRating: performanceRating !== undefined ? performanceRating : current.performance_rating,
      qualityScore: qualityScore !== undefined ? qualityScore : current.quality_score,
      safetyIncidents: safetyIncidents !== undefined ? safetyIncidents : current.safety_incidents,
      contractValue: contractValue !== undefined ? contractValue : current.contract_value,
      paymentTerms: paymentTerms !== undefined ? paymentTerms : current.payment_terms,
      isPrimaryContractor: isPrimaryContractor !== undefined ? isPrimaryContractor : current.is_primary_contractor,
      isActive: isActive !== undefined ? isActive : current.is_active,
      notes: notes !== undefined ? notes : current.notes,
      removalReason: removalReason !== undefined ? removalReason : current.removal_reason,
    };

    // Execute update
    const [updated] = await sql`
      UPDATE contractor_projects
      SET
        role = ${updatedData.role},
        assignment_status = ${updatedData.assignmentStatus},
        start_date = ${updatedData.startDate},
        end_date = ${updatedData.endDate},
        actual_end_date = ${updatedData.actualEndDate},
        workload_percentage = ${updatedData.workloadPercentage},
        estimated_hours = ${updatedData.estimatedHours},
        actual_hours = ${updatedData.actualHours},
        performance_rating = ${updatedData.performanceRating},
        quality_score = ${updatedData.qualityScore},
        safety_incidents = ${updatedData.safetyIncidents},
        contract_value = ${updatedData.contractValue},
        payment_terms = ${updatedData.paymentTerms},
        is_primary_contractor = ${updatedData.isPrimaryContractor},
        is_active = ${updatedData.isActive},
        notes = ${updatedData.notes},
        removal_reason = ${updatedData.removalReason},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, contractor_id, project_id, role, assignment_status,
             start_date, end_date, actual_end_date, workload_percentage,
             estimated_hours, actual_hours, performance_rating, quality_score,
             safety_incidents, contract_value, payment_terms,
             is_primary_contractor, is_active, notes, removal_reason,
             assigned_by, removed_by, created_at, updated_at
    `;

    return res.status(200).json({
      success: true,
      data: mapDbToAssignment(updated),
      message: 'Assignment updated successfully'
    });

  } catch (error: any) {
    log.error('Error updating contractor assignment', { error });
    return res.status(500).json({
      error: 'Failed to update assignment',
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
