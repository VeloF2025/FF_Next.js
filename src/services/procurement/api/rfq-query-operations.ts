/**
 * RFQ Query Operations
 * Handles querying, filtering, and search operations for RFQs
 */

import { BaseService, type ServiceResponse } from '../../core/BaseService';
import { auditLogger } from '../auditLogger';
import { db } from '@/lib/neon/connection';
// @ts-expect-error — module lacks type declarations
import { rfqs } from '@/lib/neon/schema';
// @ts-expect-error — module lacks type declarations
import { eq, and, desc, asc, gte, lte } from 'drizzle-orm';
// @ts-expect-error — module lacks type declarations
import type { RFQ } from '@/lib/neon/schema';
import type { ApiContext, RFQFilters } from './types';

export class RFQQueryOperations {
  constructor(private service: BaseService) {}

  /**
   * GET /api/v1/projects/{projectId}/rfqs
   */
  async getRFQList(context: ApiContext, filters: RFQFilters = {}): Promise<ServiceResponse<{ rfqs: RFQ[], total: number, page: number, limit: number }>> {
    try {
      const { page = 1, limit = 50, sortOrder = 'desc' } = filters;
      const offset = (page - 1) * limit;

      // Build query with filters
      const queryConditions = [eq(rfqs.projectId, context.projectId)];
      
      if (filters.status) {
        queryConditions.push(eq(rfqs.status, filters.status));
      }
      if (filters.createdBy) {
        queryConditions.push(eq(rfqs.createdBy, filters.createdBy));
      }
      if (filters.responseDeadline?.from) {
        queryConditions.push(gte(rfqs.responseDeadline, new Date(filters.responseDeadline.from)));
      }
      if (filters.responseDeadline?.to) {
        queryConditions.push(lte(rfqs.responseDeadline, new Date(filters.responseDeadline.to)));
      }

      // Execute query
      const rfqList = await db
        .select()
        .from(rfqs)
        .where(and(...queryConditions))
        .orderBy(sortOrder === 'desc' ? desc(rfqs.createdAt) : asc(rfqs.createdAt))
        .limit(limit)
        .offset(offset);

      // Get total count
      const totalResult = await db
        .select({ count: rfqs.id })
        .from(rfqs)
        .where(and(...queryConditions));
      const total = totalResult.length;

      // Log audit trail
      await auditLogger.logAction(context, 'view', 'rfq', 'list', null, null, {
        filters,
        resultCount: rfqList.length,
        total
      });

      return this.service.success({
        rfqs: rfqList,
        total,
        page,
        limit
      });
    } catch (error) {
      return this.service.handleError(error, 'getRFQList');
    }
  }

  /**
   * GET /api/v1/projects/{projectId}/suppliers/{supplierId}/rfqs
   */
  async getSupplierRFQHistory(context: ApiContext, supplierId: string, filters: RFQFilters = {}): Promise<ServiceResponse<{ rfqs: RFQ[], total: number }>> {
    try {
      const { page = 1, limit = 50, sortOrder = 'desc' } = filters;
      const offset = (page - 1) * limit;

      // Build query to find RFQs that include this supplier
      const queryConditions = [eq(rfqs.projectId, context.projectId)];
      
      // Get RFQs where supplier is in the invitedSuppliers array
      const rfqList = await db
        .select()
        .from(rfqs)
        .where(and(...queryConditions))
        .orderBy(sortOrder === 'desc' ? desc(rfqs.createdAt) : asc(rfqs.createdAt))
        .limit(limit)
        .offset(offset);

      // Filter RFQs that include the supplier (since we can't use array contains in basic SQL)
      const supplierRFQs = rfqList.filter((rfq: typeof rfqList[0]) =>
        Array.isArray(rfq.invitedSuppliers) && rfq.invitedSuppliers.includes(supplierId)
      );

      // Get total count for pagination
      const allRFQs = await db
        .select()
        .from(rfqs)
        .where(and(...queryConditions));
      
      const totalSupplierRFQs = allRFQs.filter((rfq: typeof allRFQs[0]) =>
        Array.isArray(rfq.invitedSuppliers) && rfq.invitedSuppliers.includes(supplierId)
      ).length;

      return this.service.success({
        rfqs: supplierRFQs,
        total: totalSupplierRFQs
      });
    } catch (error) {
      return this.service.handleError(error, 'getSupplierRFQHistory');
    }
  }
}