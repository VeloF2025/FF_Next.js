/**
 * API: Get Client Projects with PO Information
 * Returns all projects for a client with aggregated PO data
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/neon';
import { log } from '@/lib/logger';

interface ClientProject {
  id: string;
  name: string;
  code: string;
  status: string;
  priority: string;
  projectType: string;
  budget: number;
  actualCost: number;
  progress: number;
  projectManager: string;
  startDate: string;
  endDate: string;
  // PO aggregates
  poCount: number;
  totalPoValue: number;
  pendingPoValue: number;
  approvedPoCount: number;
  pendingPoCount: number;
}

interface ClientProjectsSummary {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  totalValue: number;
  totalPoValue: number;
  pendingPoValue: number;
  outstandingBalance: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Client ID is required' });
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ error: 'Invalid client ID format' });
  }

  try {
    // Get all projects for this client with PO aggregates
    const projects = await sql`
      WITH project_pos AS (
        SELECT 
          po.project_id,
          COUNT(*) as po_count,
          COALESCE(SUM(po.total_amount), 0) as total_po_value,
          COALESCE(SUM(CASE WHEN po.status IN ('pending', 'draft') THEN po.total_amount ELSE 0 END), 0) as pending_po_value,
          COUNT(CASE WHEN po.status = 'approved' THEN 1 END) as approved_po_count,
          COUNT(CASE WHEN po.status IN ('pending', 'draft') THEN 1 END) as pending_po_count
        FROM purchase_orders po
        GROUP BY po.project_id
      )
      SELECT
        p.id,
        p.project_name as name,
        p.project_code as code,
        p.status,
        p.priority,
        p.project_type as "projectType",
        COALESCE(p.budget, 0) as budget,
        COALESCE(p.actual_cost, 0) as "actualCost",
        COALESCE(p.progress, 0) as progress,
        COALESCE(s.first_name || ' ' || s.last_name, u.first_name || ' ' || u.last_name, '-') as "projectManager",
        p.start_date as "startDate",
        p.end_date as "endDate",
        COALESCE(pp.po_count, 0)::int as "poCount",
        COALESCE(pp.total_po_value, 0)::numeric as "totalPoValue",
        COALESCE(pp.pending_po_value, 0)::numeric as "pendingPoValue",
        COALESCE(pp.approved_po_count, 0)::int as "approvedPoCount",
        COALESCE(pp.pending_po_count, 0)::int as "pendingPoCount"
      FROM projects p
      LEFT JOIN project_pos pp ON pp.project_id = p.id
      LEFT JOIN staff s ON p.project_manager::text = s.id::text
      LEFT JOIN users u ON p.project_manager::text = u.id::text
      WHERE p.client_id = ${id}
      ORDER BY 
        CASE p.status 
          WHEN 'active' THEN 1 
          WHEN 'planning' THEN 2 
          WHEN 'on_hold' THEN 3 
          WHEN 'completed' THEN 4 
          ELSE 5 
        END,
        p.updated_at DESC
    `;

    // Calculate summary
    const summary: ClientProjectsSummary = {
      totalProjects: projects.length,
      activeProjects: projects.filter((p: any) => p.status === 'active').length,
      completedProjects: projects.filter((p: any) => p.status === 'completed').length,
      totalValue: projects.reduce((sum: number, p: any) => sum + Number(p.budget || 0), 0),
      totalPoValue: projects.reduce((sum: number, p: any) => sum + Number(p.totalPoValue || 0), 0),
      pendingPoValue: projects.reduce((sum: number, p: any) => sum + Number(p.pendingPoValue || 0), 0),
      outstandingBalance: 0, // Would need invoices data to calculate
    };

    // Note: outstanding_balance would need invoices/payments tables to calculate
    // For now, we leave it at 0 as set above

    log.info('Fetched client projects', { 
      data: { id, projectCount: projects.length } 
    }, 'ClientProjectsAPI');

    return res.status(200).json({
      success: true,
      data: {
        projects,
        summary
      }
    });

  } catch (error) {
    log.error('Failed to fetch client projects', { 
      data: { id, error: error instanceof Error ? error.message : 'Unknown error' } 
    }, 'ClientProjectsAPI');

    return res.status(500).json({ 
      error: 'Failed to fetch client projects',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
