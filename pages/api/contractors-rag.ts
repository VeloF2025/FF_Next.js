/**
 * Contractors RAG Status API
 * GET /api/contractors-rag?contractorId=xxx (optional)
 *
 * Returns RAG (Red/Amber/Green) status for contractors
 * Calculates on-the-fly from current contractor data
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { calculateContractorRag, prepareRagInputFromDbRow, calculateBulkRag } from '@/modules/rag/services/ragCalculationService';
import type { ContractorRagStatus } from '@/modules/rag/types/rag.types';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { contractorId } = req.query;

    // Single contractor RAG
    if (contractorId && typeof contractorId === 'string') {
      const ragStatus = await getContractorRag(contractorId);

      if (!ragStatus) {
        return res.status(404).json({ error: 'Contractor not found' });
      }

      return res.status(200).json({
        success: true,
        data: ragStatus
      });
    }

    // All contractors RAG
    const allRagStatuses = await getAllContractorsRag();

    return res.status(200).json({
      success: true,
      data: allRagStatuses,
      summary: calculateSummary(allRagStatuses)
    });

  } catch (error: any) {
    console.error('Error fetching RAG status:', error);
    return res.status(500).json({
      error: 'Failed to fetch RAG status',
      message: error.message
    });
  }
}

// ==================== HELPERS ====================

async function getContractorRag(contractorId: string): Promise<ContractorRagStatus | null> {
  // Fetch contractor with aggregated data for RAG calculation
  const [contractor] = await sql`
    SELECT
      c.id,
      c.company_name,
      c.credit_rating,
      c.total_projects,
      c.completed_projects,
      c.cancelled_projects,
      c.quality_score,
      c.performance_score,
      c.safety_score,
      c.timeliness_score,

      -- Count document statuses
      COUNT(CASE WHEN cd.expiry_date < NOW() THEN 1 END) as expired_documents_count,
      COUNT(CASE WHEN cd.expiry_date BETWEEN NOW() AND NOW() + INTERVAL '30 days' THEN 1 END) as expiring_soon_count,

      -- Safety incidents (placeholder - would need incidents table)
      0 as safety_incidents_12m,
      NULL as last_safety_audit_date

    FROM contractors c
    LEFT JOIN contractor_documents cd ON cd.contractor_id = c.id
    WHERE c.id = ${contractorId}
    GROUP BY c.id, c.company_name, c.credit_rating, c.total_projects, c.completed_projects,
             c.cancelled_projects, c.quality_score, c.performance_score, c.safety_score, c.timeliness_score
  `;

  if (!contractor) return null;

  // Prepare input and calculate RAG
  const input = prepareRagInputFromDbRow(contractor);
  return calculateContractorRag(input, contractor.company_name);
}

async function getAllContractorsRag(): Promise<ContractorRagStatus[]> {
  // Fetch all contractors with aggregated data
  const contractors = await sql`
    SELECT
      c.id,
      c.company_name,
      c.credit_rating,
      c.total_projects,
      c.completed_projects,
      c.cancelled_projects,
      c.quality_score,
      c.performance_score,
      c.safety_score,
      c.timeliness_score,

      -- Count document statuses
      COUNT(CASE WHEN cd.expiry_date < NOW() THEN 1 END) as expired_documents_count,
      COUNT(CASE WHEN cd.expiry_date BETWEEN NOW() AND NOW() + INTERVAL '30 days' THEN 1 END) as expiring_soon_count,

      -- Safety incidents (placeholder)
      0 as safety_incidents_12m,
      NULL as last_safety_audit_date

    FROM contractors c
    LEFT JOIN contractor_documents cd ON cd.contractor_id = c.id
    WHERE c.is_active = true
    GROUP BY c.id, c.company_name, c.credit_rating, c.total_projects, c.completed_projects,
             c.cancelled_projects, c.quality_score, c.performance_score, c.safety_score, c.timeliness_score
    ORDER BY c.company_name
  `;

  return calculateBulkRag(contractors);
}

function calculateSummary(ragStatuses: ContractorRagStatus[]) {
  const summary = {
    total: ragStatuses.length,
    red: 0,
    amber: 0,
    green: 0,
    byCategory: {
      financial: { red: 0, amber: 0, green: 0 },
      compliance: { red: 0, amber: 0, green: 0 },
      performance: { red: 0, amber: 0, green: 0 },
      safety: { red: 0, amber: 0, green: 0 },
    }
  };

  ragStatuses.forEach(status => {
    // Count overall
    summary[status.overall]++;

    // Count by category
    summary.byCategory.financial[status.financial]++;
    summary.byCategory.compliance[status.compliance]++;
    summary.byCategory.performance[status.performance]++;
    summary.byCategory.safety[status.safety]++;
  });

  return summary;
}

export default withAuth(handler);
