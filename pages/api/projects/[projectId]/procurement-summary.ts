/**
 * Project Procurement Summary API
 * GET /api/projects/[projectId]/procurement-summary
 *
 * Returns procurement summary (BOQ, RFQ, PO, GRN counts and values)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const getSql = () => neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.validationError(res, { projectId: 'Project ID is required' });
  }

  try {
    const sql = getSql();

    // Check project exists
    const projectExists = await sql`
      SELECT id FROM projects WHERE id = ${projectId}
    `;

    if (!projectExists || projectExists.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    // Get BOQ counts
    const boqStats = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE status = 'draft') as draft
      FROM boqs
      WHERE project_id = ${projectId}
    `;

    // Get RFQ counts (project_id is VARCHAR)
    const rfqStats = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'open') as open,
        COUNT(*) FILTER (WHERE status = 'closed') as closed,
        COUNT(*) FILTER (WHERE status = 'awarded') as awarded
      FROM rfqs
      WHERE project_id::text = ${projectId}
    `;

    // Get PO counts and values
    const poStats = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending_approval') as pending,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COALESCE(SUM(total_amount), 0) as total_value,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'approved'), 0) as approved_value,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'completed'), 0) as completed_value
      FROM purchase_orders
      WHERE project_id = ${projectId}
    `;

    // Get GRN counts and values
    const grnStats = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'received') as received,
        COALESCE(SUM(total_received_value), 0) as total_value
      FROM goods_receipt_notes
      WHERE project_id = ${projectId}
    `;

    // Format response
    const response = {
      boqs: Number(boqStats[0]?.total) || 0,
      boqsApproved: Number(boqStats[0]?.approved) || 0,
      boqsDraft: Number(boqStats[0]?.draft) || 0,

      rfqs: Number(rfqStats[0]?.total) || 0,
      rfqsOpen: Number(rfqStats[0]?.open) || 0,
      pendingRFQs: Number(rfqStats[0]?.open) || 0,

      pos: Number(poStats[0]?.total) || 0,
      pendingPOs: Number(poStats[0]?.pending) || 0,
      approvedPOs: Number(poStats[0]?.approved) || 0,
      completedPOs: Number(poStats[0]?.completed) || 0,
      totalPoValue: Number(poStats[0]?.total_value) || 0,
      approvedPoValue: Number(poStats[0]?.approved_value) || 0,

      grns: Number(grnStats[0]?.total) || 0,
      pendingGRNs: Number(grnStats[0]?.pending) || 0,
      totalGrnValue: Number(grnStats[0]?.total_value) || 0,
    };

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('Error fetching procurement summary', { error, projectId });
    return apiResponse.internalError(res, error as Error);
  }
}

export default withAuth(handler);
