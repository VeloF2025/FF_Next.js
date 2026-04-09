/**
 * RFQ Supplier Operations
 * Handles supplier management operations for RFQs
 */

import { BaseService, type ServiceResponse } from '../../core/BaseService';
import { ProcurementError } from '../procurementErrors';
import { auditLogger } from '../auditLogger';
import { db } from '@/lib/neon/connection';
// @ts-expect-error — module lacks type declarations
import { rfqs } from '@/lib/neon/schema';
// @ts-expect-error — module lacks type declarations
import { eq, and } from 'drizzle-orm';
import type { ApiContext } from './types';

export class RFQSupplierOperations {
  constructor(private service: BaseService) {}

  /**
   * POST /api/v1/projects/{projectId}/rfqs/{rfqId}/suppliers
   */
  async addSuppliersToRFQ(context: ApiContext, rfqId: string, supplierIds: string[]): Promise<ServiceResponse<void>> {
    try {
      // Validate RFQ exists
      const existing = await db
        .select()
        .from(rfqs)
        .where(and(eq(rfqs.id, rfqId), eq(rfqs.projectId, context.projectId)))
        .limit(1);

      if (existing.length === 0) {
        throw new ProcurementError('RFQ not found', 'RFQ_NOT_FOUND', 404);
      }

      const rfq = existing[0];
      const currentSuppliers = Array.isArray(rfq.invitedSuppliers) ? rfq.invitedSuppliers : [];
      const newSuppliers = [...new Set([...currentSuppliers, ...supplierIds])];

      // Update RFQ with new suppliers
      const [updatedRFQ] = await db
        .update(rfqs)
        .set({
          invitedSuppliers: newSuppliers,
          updatedAt: new Date()
        })
        .where(and(eq(rfqs.id, rfqId), eq(rfqs.projectId, context.projectId)))
        .returning();

      // Log audit trail
      await auditLogger.logAction(context, 'update', 'rfq', rfqId, rfq, updatedRFQ, {
        operation: 'add_suppliers',
        addedSuppliers: supplierIds
      });

      return this.service.success(undefined);
    } catch (error) {
      return this.service.handleError(error, 'addSuppliersToRFQ');
    }
  }

  /**
   * DELETE /api/v1/projects/{projectId}/rfqs/{rfqId}/suppliers
   */
  async removeSuppliersFromRFQ(context: ApiContext, rfqId: string, supplierIds: string[]): Promise<ServiceResponse<void>> {
    try {
      // Validate RFQ exists
      const existing = await db
        .select()
        .from(rfqs)
        .where(and(eq(rfqs.id, rfqId), eq(rfqs.projectId, context.projectId)))
        .limit(1);

      if (existing.length === 0) {
        throw new ProcurementError('RFQ not found', 'RFQ_NOT_FOUND', 404);
      }

      const rfq = existing[0];
      const currentSuppliers = Array.isArray(rfq.invitedSuppliers) ? rfq.invitedSuppliers : [];
      const remainingSuppliers = currentSuppliers.filter((id: string) => !supplierIds.includes(id));

      // Update RFQ with remaining suppliers
      const [updatedRFQ] = await db
        .update(rfqs)
        .set({
          invitedSuppliers: remainingSuppliers,
          updatedAt: new Date()
        })
        .where(and(eq(rfqs.id, rfqId), eq(rfqs.projectId, context.projectId)))
        .returning();

      // Log audit trail
      await auditLogger.logAction(context, 'update', 'rfq', rfqId, rfq, updatedRFQ, {
        operation: 'remove_suppliers',
        removedSuppliers: supplierIds
      });

      return this.service.success(undefined);
    } catch (error) {
      return this.service.handleError(error, 'removeSuppliersFromRFQ');
    }
  }

  /**
   * PUT /api/v1/projects/{projectId}/rfqs/{rfqId}/suppliers
   */
  async replaceRFQSuppliers(context: ApiContext, rfqId: string, supplierIds: string[]): Promise<ServiceResponse<void>> {
    try {
      // Validate RFQ exists
      const existing = await db
        .select()
        .from(rfqs)
        .where(and(eq(rfqs.id, rfqId), eq(rfqs.projectId, context.projectId)))
        .limit(1);

      if (existing.length === 0) {
        throw new ProcurementError('RFQ not found', 'RFQ_NOT_FOUND', 404);
      }

      const rfq = existing[0];

      // Replace suppliers
      const [updatedRFQ] = await db
        .update(rfqs)
        .set({
          invitedSuppliers: supplierIds,
          updatedAt: new Date()
        })
        .where(and(eq(rfqs.id, rfqId), eq(rfqs.projectId, context.projectId)))
        .returning();

      // Log audit trail
      await auditLogger.logAction(context, 'update', 'rfq', rfqId, rfq, updatedRFQ, {
        operation: 'replace_suppliers',
        previousSuppliers: Array.isArray(rfq.invitedSuppliers) ? rfq.invitedSuppliers : [],
        newSuppliers: supplierIds
      });

      return this.service.success(undefined);
    } catch (error) {
      return this.service.handleError(error, 'replaceRFQSuppliers');
    }
  }
}