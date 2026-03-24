/**
 * Project Contractors H&S API
 * GET /api/projects/[projectId]/contractors-hs - Get H&S status for all contractors on project
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { sql } from '@/lib/neon';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

interface ContractorHSStatus {
  contractor_id: string;
  company_name: string;
  contact_person: string | null;
  role: string;
  assignment_status: string;
  // H&S compliance
  overall_score: number;
  rag_status: 'red' | 'amber' | 'green';
  document_score: number;
  incident_score: number;
  training_score: number;
  audit_score: number;
  // Gate status
  is_gate_approved: boolean;
  gate_blockers: string[];
  gate_warnings: string[];
  // Recent activity
  last_audit_date: string | null;
  next_audit_due: string | null;
  open_incidents: number;
  calculated_at: string | null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    // Verify project exists
    const projectResult = await sql`
      SELECT id, project_name FROM projects WHERE id = ${projectId}
    `;

    if (projectResult.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    // Get all contractors assigned to this project with their H&S status
    // Note: contractor_projects.contractor_id is UUID, hs_contractor_compliance.contractor_id is INTEGER
    // We need to handle this by joining through contractors table
    const contractorsResult = await sql`
      SELECT
        cp.contractor_id,
        c.company_name,
        c.contact_person,
        cp.role,
        cp.assignment_status,
        -- H&S compliance scores
        COALESCE(hcc.overall_score, 0) AS overall_score,
        COALESCE(hcc.rag_status, 'red') AS rag_status,
        COALESCE(hcc.document_score, 0) AS document_score,
        COALESCE(hcc.incident_score, 100) AS incident_score,
        COALESCE(hcc.training_score, 0) AS training_score,
        COALESCE(hcc.audit_score, 0) AS audit_score,
        -- Gate status
        COALESCE(hcc.is_gate_approved, false) AS is_gate_approved,
        COALESCE(hcc.gate_blockers, '[]'::jsonb) AS gate_blockers,
        COALESCE(hcc.gate_warnings, '[]'::jsonb) AS gate_warnings,
        -- Dates
        hcc.last_audit_date,
        hcc.next_audit_due,
        hcc.calculated_at,
        -- Count open incidents for this contractor
        (
          SELECT COUNT(*)
          FROM tickets t
          JOIN hs_ticket_details htd ON htd.ticket_id = t.id
          WHERE t.assigned_contractor_id = c.id::text
            AND t.status NOT IN ('closed', 'cancelled')
        )::int AS open_incidents
      FROM contractor_projects cp
      JOIN contractors c ON c.id = cp.contractor_id
      LEFT JOIN hs_contractor_compliance hcc ON hcc.contractor_id = c.id::int
      WHERE cp.project_id = ${projectId}
        AND cp.is_active = true
        AND cp.assignment_status IN ('assigned', 'active')
      ORDER BY cp.is_primary_contractor DESC, c.company_name
    `;

    // Parse JSONB fields
    const contractors: ContractorHSStatus[] = (contractorsResult as Record<string, unknown>[]).map(row => ({
      contractor_id: String(row.contractor_id),
      company_name: String(row.company_name),
      contact_person: row.contact_person ? String(row.contact_person) : null,
      role: String(row.role),
      assignment_status: String(row.assignment_status),
      overall_score: Number(row.overall_score),
      rag_status: String(row.rag_status) as 'red' | 'amber' | 'green',
      document_score: Number(row.document_score),
      incident_score: Number(row.incident_score),
      training_score: Number(row.training_score),
      audit_score: Number(row.audit_score),
      is_gate_approved: Boolean(row.is_gate_approved),
      gate_blockers: Array.isArray(row.gate_blockers) ? row.gate_blockers as string[] : [],
      gate_warnings: Array.isArray(row.gate_warnings) ? row.gate_warnings as string[] : [],
      last_audit_date: row.last_audit_date ? String(row.last_audit_date) : null,
      next_audit_due: row.next_audit_due ? String(row.next_audit_due) : null,
      open_incidents: Number(row.open_incidents),
      calculated_at: row.calculated_at ? String(row.calculated_at) : null,
    }));

    // Calculate summary stats
    const total = contractors.length;
    const gateApproved = contractors.filter(c => c.is_gate_approved).length;
    const gateBlocked = contractors.filter(c => !c.is_gate_approved && c.gate_blockers.length > 0).length;
    const redCount = contractors.filter(c => c.rag_status === 'red').length;
    const amberCount = contractors.filter(c => c.rag_status === 'amber').length;
    const greenCount = contractors.filter(c => c.rag_status === 'green').length;
    const totalOpenIncidents = contractors.reduce((sum, c) => sum + c.open_incidents, 0);
    const avgScore = total > 0
      ? Math.round(contractors.reduce((sum, c) => sum + c.overall_score, 0) / total)
      : 0;

    return apiResponse.success(res, {
      contractors,
      summary: {
        total,
        gate_approved: gateApproved,
        gate_blocked: gateBlocked,
        rag: {
          red: redCount,
          amber: amberCount,
          green: greenCount,
        },
        average_score: avgScore,
        total_open_incidents: totalOpenIncidents,
      },
    });
  } catch (error) {
    log.error('Failed to fetch contractors H&S status', { projectId, error }, 'contractors-hs-api');
    return apiResponse.databaseError(res, error, 'Failed to fetch contractors H&S status');
  }
}

export default withAuth(withErrorHandler(handler));
