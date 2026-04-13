/**
 * RFQ CRUD Operations
 * Handles basic Create, Read, Update, Delete operations for RFQs
 */

import { BaseService, type ServiceResponse } from '../../core/BaseService';
import { ProcurementError, RFQValidationError } from '../procurementErrors';
import { validateSchema, NewRFQSchema, UpdateRFQSchema } from '@/lib/validation/procurement.schemas';
import { auditLogger } from '../auditLogger';
import { db } from '@/lib/neon/connection';
// @ts-expect-error — module lacks type declarations
import { rfqs } from '@/lib/neon/schema';
// @ts-expect-error — module lacks type declarations
import { eq, and } from 'drizzle-orm';
// @ts-expect-error — module lacks type declarations
import type { RFQ, NewRFQ } from '@/lib/neon/schema';
import type { ApiContext } from './types';

export class RFQCrudOperations {
  constructor(private service: BaseService) {}

  /**
   * GET /api/v1/projects/{projectId}/rfqs/{rfqId}
   */
  async getRFQById(context: ApiContext, rfqId: string): Promise<ServiceResponse<RFQ>> {
    try {
      const rfqResult = await db
        .select()
        .from(rfqs)
        .where(and(eq(rfqs.id, rfqId), eq(rfqs.projectId, context.projectId)))
        .limit(1);

      if (rfqResult.length === 0) {
        return this.service.handleError(new ProcurementError('RFQ not found', 'RFQ_NOT_FOUND', 404), 'getRFQById');
      }

      // Log audit trail
      await auditLogger.logAction(context, 'view', 'rfq', rfqId);

      return this.service.success(rfqResult[0]);
    } catch (error) {
      return this.service.handleError(error, 'getRFQById');
    }
  }

  /**
   * POST /api/v1/projects/{projectId}/rfqs
   */
  async createRFQ(context: ApiContext, rfqData: unknown): Promise<ServiceResponse<RFQ>> {
    try {
      // Validate RFQ data
      const validation = validateSchema(NewRFQSchema, rfqData);
      if (!validation.success) {
        return this.service.handleError(
          new RFQValidationError('Invalid RFQ data', validation.error?.issues || []),
          'createRFQ'
        );
      }

      const validData = validation.data!;

      // Create RFQ record
      const newRFQ: NewRFQ = {
        projectId: context.projectId,
        rfqNumber: `RFQ-${Date.now()}`, // Generate unique RFQ number
        title: validData.title,
        description: validData.description,
        status: 'draft',
        responseDeadline: new Date(validData.responseDeadline),
        paymentTerms: validData.paymentTerms,
        deliveryTerms: validData.deliveryTerms,
        validityPeriod: validData.validityPeriod,
        currency: validData.currency || 'ZAR',
        technicalRequirements: validData.technicalRequirements,
        invitedSuppliers: validData.invitedSuppliers || [],
        createdBy: context.userId,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const rfqResult = await db.insert(rfqs).values(newRFQ).returning();
      const rfq = rfqResult[0];

      // Send invitations to suppliers
      if (validData.invitedSuppliers && validData.invitedSuppliers.length > 0) {
        // TODO: Implement supplier invitation logic
      }

      // Log audit trail
      await auditLogger.logAction(context, 'create', 'rfq', rfq.id, null, rfq, {
        operation: 'create',
        supplierCount: validData.invitedSuppliers?.length || 0
      });

      return this.service.success(rfq);
    } catch (error) {
      return this.service.handleError(error, 'createRFQ');
    }
  }

  /**
   * PUT /api/v1/projects/{projectId}/rfqs/{rfqId}
   */
  async updateRFQ(context: ApiContext, rfqId: string, updateData: unknown): Promise<ServiceResponse<RFQ>> {
    try {
      // Validate input data
      const validation = validateSchema(UpdateRFQSchema, updateData);
      if (!validation.success) {
        throw new RFQValidationError('Invalid RFQ update data', validation.error?.issues || []);
      }

      const validData = validation.data!;

      // Get existing RFQ
      const existing = await db
        .select()
        .from(rfqs)
        .where(and(eq(rfqs.id, rfqId), eq(rfqs.projectId, context.projectId)))
        .limit(1);

      if (existing.length === 0) {
        throw new ProcurementError('RFQ not found', 'RFQ_NOT_FOUND', 404);
      }

      const oldRFQ = existing[0];

      // Update RFQ
      const updateFields: Record<string, unknown> = {
        ...validData,
        updatedAt: new Date()
      };
      
      const [rfq] = await db
        .update(rfqs)
        .set(updateFields)
        .where(and(eq(rfqs.id, rfqId), eq(rfqs.projectId, context.projectId)))
        .returning();

      // Log audit trail
      await auditLogger.logAction(context, 'update', 'rfq', rfq.id, oldRFQ, rfq, {
        operation: 'update',
        changedFields: Object.keys(validData || {})
      });

      return this.service.success(rfq);
    } catch (error) {
      return this.service.handleError(error, 'updateRFQ');
    }
  }

  /**
   * DELETE /api/v1/projects/{projectId}/rfqs/{rfqId}
   */
  async deleteRFQ(context: ApiContext, rfqId: string): Promise<ServiceResponse<void>> {
    try {
      // Get existing RFQ for audit trail
      const existing = await db
        .select()
        .from(rfqs)
        .where(and(eq(rfqs.id, rfqId), eq(rfqs.projectId, context.projectId)))
        .limit(1);

      if (existing.length === 0) {
        throw new ProcurementError('RFQ not found', 'RFQ_NOT_FOUND', 404);
      }

      const oldRFQ = existing[0];

      // Delete RFQ
      await db
        .delete(rfqs)
        .where(and(eq(rfqs.id, rfqId), eq(rfqs.projectId, context.projectId)));

      // Log audit trail
      await auditLogger.logAction(context, 'delete', 'rfq', rfqId, oldRFQ, null, {
        operation: 'delete'
      });

      return this.service.success(undefined);
    } catch (error) {
      return this.service.handleError(error, 'deleteRFQ');
    }
  }
}