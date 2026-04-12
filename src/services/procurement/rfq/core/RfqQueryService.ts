/**
 * RFQ Query Service
 * Query operations and statistics for RFQs
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { RFQ, RFQStatus } from '@/types/procurement.types';

const sql = neon(process.env.DATABASE_URL!);

/** Raw RFQ row as returned by the database */
interface RfqRow {
  id: string;
  project_id: string;
  rfq_number: string;
  title: string;
  description: string;
  status: string;
  issue_date: string;
  response_deadline: string;
  closing_date: string;
  invited_suppliers: string;
  item_count: string;
  response_count: string;
  payment_terms: string;
  delivery_terms: string;
  validity_period: number;
  currency: string;
  technical_requirements: string;
  total_budget_estimate: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  total?: string;
  total_rfqs?: string;
  draft_count?: string;
  issued_count?: string;
  responses_received_count?: string;
  evaluated_count?: string;
  awarded_count?: string;
  closed_count?: string;
  cancelled_count?: string;
  total_budget?: string;
  average_budget?: string;
}

export class RfqQueryService {
  /**
   * Get all RFQs with filtering and pagination
   */
  static async getAll(filter?: {
    projectId?: string;
    status?: RFQStatus;
    supplierId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ rfqs: RFQ[], total: number }> {
    try {
      const conditions = [];
      const params: unknown[] = [];

      if (filter?.projectId) {
        conditions.push(`project_id = $${params.length + 1}`);
        params.push(filter.projectId);
      }
      if (filter?.status) {
        conditions.push(`status = $${params.length + 1}`);
        params.push(filter.status);
      }
      if (filter?.supplierId) {
        conditions.push(`invited_suppliers::jsonb @> $${params.length + 1}::jsonb`);
        params.push(JSON.stringify([filter.supplierId]));
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = filter?.limit || 100;
      const offset = ((filter?.page || 1) - 1) * limit;

      // Get total count
      const countResult = await sql.query(
        `SELECT COUNT(*) as total FROM rfqs ${whereClause}`,
        params as unknown[]
      );

      // Get paginated results
      params.push(limit);
      params.push(offset);

      const result = await sql.query(
        `SELECT
          r.*,
          COUNT(DISTINCT ri.id) as item_count,
          COUNT(DISTINCT rr.id) as response_count
        FROM rfqs r
        LEFT JOIN rfq_items ri ON r.id = ri.rfq_id
        LEFT JOIN rfq_responses rr ON r.id = rr.rfq_id
        ${whereClause}
        GROUP BY r.id
        ORDER BY r.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params as unknown[]
      );

      const rfqs = (result as unknown as RfqRow[]).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        rfqNumber: row.rfq_number,
        title: row.title,
        description: row.description,
        status: row.status as RFQStatus,
        issueDate: row.issue_date,
        responseDeadline: row.response_deadline,
        closingDate: row.closing_date,
        invitedSuppliers: JSON.parse(row.invited_suppliers || '[]'),
        itemCount: parseInt(row.item_count) || 0,
        responseCount: parseInt(row.response_count) || 0,
        paymentTerms: row.payment_terms,
        deliveryTerms: row.delivery_terms,
        validityPeriod: row.validity_period || 30,
        currency: row.currency || 'ZAR',
        technicalRequirements: row.technical_requirements,
        totalBudgetEstimate: row.total_budget_estimate,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      } as unknown as RFQ));

      return {
        rfqs,
        total: parseInt((countResult as unknown as RfqRow[])[0]?.total ?? '0')
      };
    } catch (error) {
      log.error('Error fetching RFQs:', { data: error }, 'RfqQueryService');
      throw error;
    }
  }

  /**
   * Get RFQ statistics
   */
  static async getStatistics(projectId?: string): Promise<{
    totalRFQs: number;
    byStatus: Record<string, number>;
    totalBudget: number;
    averageBudget: number;
  }> {
    try {
      let whereClause = '';
      const params: unknown[] = [];

      if (projectId) {
        whereClause = 'WHERE project_id = $1';
        params.push(projectId);
      }

      const stats = await sql.query(
        `SELECT
          COUNT(*) as total_rfqs,
          COUNT(CASE WHEN status = 'draft' THEN 1 END) as draft_count,
          COUNT(CASE WHEN status = 'issued' THEN 1 END) as issued_count,
          COUNT(CASE WHEN status = 'responses_received' THEN 1 END) as responses_received_count,
          COUNT(CASE WHEN status = 'evaluated' THEN 1 END) as evaluated_count,
          COUNT(CASE WHEN status = 'awarded' THEN 1 END) as awarded_count,
          COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_count,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_count,
          SUM(total_budget_estimate) as total_budget,
          AVG(total_budget_estimate) as average_budget
        FROM rfqs ${whereClause}`,
        params as unknown[]
      );

      const row: RfqRow = (stats as unknown as RfqRow[])[0] ?? ({} as RfqRow);
      return {
        totalRFQs: parseInt(row.total_rfqs ?? '0'),
        byStatus: {
          draft: parseInt(row.draft_count ?? '0'),
          issued: parseInt(row.issued_count ?? '0'),
          responsesReceived: parseInt(row.responses_received_count ?? '0'),
          evaluated: parseInt(row.evaluated_count ?? '0'),
          awarded: parseInt(row.awarded_count ?? '0'),
          closed: parseInt(row.closed_count ?? '0'),
          cancelled: parseInt(row.cancelled_count ?? '0')
        },
        totalBudget: parseFloat(row.total_budget ?? '0'),
        averageBudget: parseFloat(row.average_budget ?? '0')
      };
    } catch (error) {
      log.error('Error fetching RFQ statistics:', { data: error }, 'RfqQueryService');
      throw error;
    }
  }

  /**
   * Search RFQs by keyword
   */
  static async search(keyword: string, projectId?: string): Promise<RFQ[]> {
    try {
      let whereClause = `WHERE (title ILIKE $1 OR rfq_number ILIKE $1 OR description ILIKE $1)`;
      const params: unknown[] = [`%${keyword}%`];

      if (projectId) {
        whereClause += ` AND project_id = $2`;
        params.push(projectId);
      }

      const result = await sql.query(
        `SELECT
          r.*,
          COUNT(DISTINCT ri.id) as item_count,
          COUNT(DISTINCT rr.id) as response_count
        FROM rfqs r
        LEFT JOIN rfq_items ri ON r.id = ri.rfq_id
        LEFT JOIN rfq_responses rr ON r.id = rr.rfq_id
        ${whereClause}
        GROUP BY r.id
        ORDER BY r.created_at DESC
        LIMIT 50`,
        params as unknown[]
      );

      return (result as unknown as RfqRow[]).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        rfqNumber: row.rfq_number,
        title: row.title,
        description: row.description,
        status: row.status as RFQStatus,
        itemCount: parseInt(row.item_count) || 0,
        responseCount: parseInt(row.response_count) || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      } as unknown as RFQ));
    } catch (error) {
      log.error('Error searching RFQs:', { data: error }, 'RfqQueryService');
      throw error;
    }
  }
}
