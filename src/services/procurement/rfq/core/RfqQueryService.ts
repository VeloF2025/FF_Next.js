/**
 * RFQ Query Service
 * Query operations and statistics for RFQs
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { RFQ, RFQStatus } from '@/types/procurement.types';

const sql = neon(process.env.DATABASE_URL!);

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
      const params: any[] = [];

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
      const countResult = await sql(
        `SELECT COUNT(*) as total FROM rfqs ${whereClause}`,
        params
      );

      // Get paginated results
      params.push(limit);
      params.push(offset);

      const result = await sql(
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
        params
      );

      const rfqs = result.map(row => ({
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
      } as RFQ));

      return {
        rfqs,
        total: parseInt(countResult[0].total)
      };
    } catch (error) {
      log.error('Error fetching RFQs:', { data: error }, 'RfqQueryService');
      throw error;
    }
  }

  /**
   * Get RFQ statistics
   */
  static async getStatistics(projectId?: string): Promise<any> {
    try {
      let whereClause = '';
      const params: any[] = [];

      if (projectId) {
        whereClause = 'WHERE project_id = $1';
        params.push(projectId);
      }

      const stats = await sql(
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
        params
      );

      return {
        totalRFQs: parseInt(stats[0].total_rfqs),
        byStatus: {
          draft: parseInt(stats[0].draft_count),
          issued: parseInt(stats[0].issued_count),
          responsesReceived: parseInt(stats[0].responses_received_count),
          evaluated: parseInt(stats[0].evaluated_count),
          awarded: parseInt(stats[0].awarded_count),
          closed: parseInt(stats[0].closed_count),
          cancelled: parseInt(stats[0].cancelled_count)
        },
        totalBudget: parseFloat(stats[0].total_budget || 0),
        averageBudget: parseFloat(stats[0].average_budget || 0)
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
      const params: any[] = [`%${keyword}%`];

      if (projectId) {
        whereClause += ` AND project_id = $2`;
        params.push(projectId);
      }

      const result = await sql(
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
        params
      );

      return result.map(row => ({
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
      } as RFQ));
    } catch (error) {
      log.error('Error searching RFQs:', { data: error }, 'RfqQueryService');
      throw error;
    }
  }
}
