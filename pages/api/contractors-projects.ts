/**
 * Contractor Projects API - Flat Endpoint
 * GET /api/contractors-projects?contractorId=xxx (or ?projectId=xxx)
 * POST /api/contractors-projects
 *
 * Manages contractor assignments to projects
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import type { ContractorProject, ContractorProjectWithDetails } from '@/types/contractor-project.types';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'POST') {
    return handlePost(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

// ==================== GET - List assignments ====================
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { contractorId, projectId, assignmentStatus, isActive } = req.query;

    // At least one filter must be provided
    if (!contractorId && !projectId) {
      return res.status(400).json({
        error: 'Either contractorId or projectId is required'
      });
    }

    // Build query with optional filters
    const assignments = await sql`
      SELECT
        cp.*,
        c.company_name,
        c.contact_person,
        c.email,
        c.status as contractor_status,
        p.project_name,
        p.project_code,
        p.status as project_status
      FROM contractor_projects cp
      JOIN contractors c ON cp.contractor_id = c.id
      JOIN projects p ON cp.project_id = p.id
      WHERE 1=1
        ${contractorId ? sql`AND cp.contractor_id = ${contractorId}` : sql``}
        ${projectId ? sql`AND cp.project_id = ${projectId}` : sql``}
        ${assignmentStatus ? sql`AND cp.assignment_status = ${assignmentStatus}` : sql``}
        ${isActive !== undefined ? sql`AND cp.is_active = ${isActive === 'true'}` : sql``}
      ORDER BY cp.created_at DESC
    `;

    const mapped = assignments.map(mapDbToAssignment);

    return res.status(200).json({
      success: true,
      data: mapped
    });

  } catch (error: any) {
    console.error('Error fetching contractor projects:', error);
    return res.status(500).json({
      error: 'Failed to fetch contractor projects',
      message: error.message
    });
  }
}

// ==================== POST - Create assignment ====================
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      contractorId,
      projectId,
      role,
      assignmentStatus = 'assigned',
      startDate,
      endDate,
      workloadPercentage = 100,
      estimatedHours,
      contractValue,
      paymentTerms,
      isPrimaryContractor = false,
      notes,
      assignedBy
    } = req.body;

    // Validate required fields
    if (!contractorId || !projectId || !role || !startDate) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['contractorId', 'projectId', 'role', 'startDate']
      });
    }

    // Check if assignment already exists
    const existing = await sql`
      SELECT id FROM contractor_projects
      WHERE contractor_id = ${contractorId}
        AND project_id = ${projectId}
        AND role = ${role}
      LIMIT 1
    `;

    if (existing.length > 0) {
      return res.status(409).json({
        error: 'Assignment already exists for this contractor, project, and role'
      });
    }

    // Create assignment
    const [assignment] = await sql`
      INSERT INTO contractor_projects (
        contractor_id,
        project_id,
        role,
        assignment_status,
        start_date,
        end_date,
        workload_percentage,
        estimated_hours,
        contract_value,
        payment_terms,
        is_primary_contractor,
        notes,
        assigned_by
      ) VALUES (
        ${contractorId},
        ${projectId},
        ${role},
        ${assignmentStatus},
        ${startDate},
        ${endDate || null},
        ${workloadPercentage},
        ${estimatedHours || null},
        ${contractValue || null},
        ${paymentTerms || null},
        ${isPrimaryContractor},
        ${notes || null},
        ${assignedBy || null}
      )
      RETURNING *
    `;

    const mapped = mapDbToAssignmentCore(assignment);

    return res.status(201).json({
      success: true,
      data: mapped,
      message: 'Contractor assignment created successfully'
    });

  } catch (error: any) {
    console.error('Error creating contractor assignment:', error);
    return res.status(500).json({
      error: 'Failed to create contractor assignment',
      message: error.message
    });
  }
}

// ==================== MAPPERS ====================

function mapDbToAssignmentCore(row: any): ContractorProject {
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

function mapDbToAssignment(row: any): ContractorProjectWithDetails {
  return {
    ...mapDbToAssignmentCore(row),
    companyName: row.company_name,
    contactPerson: row.contact_person,
    email: row.email,
    contractorStatus: row.contractor_status,
    projectName: row.project_name,
    projectCode: row.project_code,
    projectStatus: row.project_status
  };
}

export default withAuth(handler);
