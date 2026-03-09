/**
 * BOQ API Operations
 * Handles all BOQ-related API operations
 */

import { BaseService, type ServiceResponse } from '../../core/BaseService';
import { ProcurementError, RFQValidationError } from '../procurementErrors';
import { validateSchema, ProcurementSchemas } from '@/lib/validation';
import { auditLogger } from '../auditLogger';
import { db } from '@/lib/neon/connection';
// @ts-ignore
import { boqs, boqItems, boqExceptions } from '@/lib/neon/schema';
// @ts-ignore
import { eq, and, desc, asc } from 'drizzle-orm';
// @ts-ignore
import type { BOQ, NewBOQ, BOQItem, NewBOQItem, BOQException } from '@/lib/neon/schema';
import type { ApiContext, BOQFilters, BOQImportData } from './types';

export class BOQOperations {
  constructor(private service: BaseService) {}

  /**
   * GET /api/v1/projects/{projectId}/boqs
   */
  async getBOQList(context: ApiContext, filters: BOQFilters = {}): Promise<ServiceResponse<{ boqs: BOQ[], total: number, page: number, limit: number }>> {
    try {
      const { page = 1, limit = 50, sortOrder = 'desc' } = filters;
      const offset = (page - 1) * limit;

      // Build query with filters
      const queryConditions = [eq(boqs.projectId, context.projectId)];
      
      if (filters.status) {
        queryConditions.push(eq(boqs.status, filters.status as any));
      }
      if (filters.mappingStatus) {
        queryConditions.push(eq(boqs.mappingStatus, filters.mappingStatus as any));
      }
      if (filters.uploadedBy) {
        queryConditions.push(eq(boqs.uploadedBy, filters.uploadedBy));
      }

      // Execute query
      const boqList = await db
        .select()
        .from(boqs)
        .where(and(...queryConditions))
        .orderBy(sortOrder === 'desc' ? desc(boqs.uploadedAt) : asc(boqs.uploadedAt))
        .limit(limit)
        .offset(offset);

      // Get total count
      const totalResult = await db
        .select({ count: boqs.id })
        .from(boqs)
        .where(and(...queryConditions));
      const total = totalResult.length;

      // Log audit trail
      await auditLogger.logAction(context, 'view', 'boq', 'list', null, null, {
        filters,
        resultCount: boqList.length,
        total
      });

      return this.service.success({
        boqs: boqList,
        total,
        page,
        limit
      });
    } catch (error) {
      return this.service.handleError(error, 'getBOQList');
    }
  }

  /**
   * GET /api/v1/projects/{projectId}/boqs/{boqId}
   */
  async getBOQById(context: ApiContext, boqId: string): Promise<ServiceResponse<BOQ & { items: BOQItem[], exceptions: BOQException[] }>> {
    try {
      // Get BOQ
      const boqResult = await db
        .select()
        .from(boqs)
        .where(and(eq(boqs.id, boqId), eq(boqs.projectId, context.projectId)))
        .limit(1);

      if (boqResult.length === 0) {
        return this.service.handleError(new ProcurementError('BOQ not found', 'BOQ_NOT_FOUND', 404), 'getBOQById');
      }

      const boq = boqResult[0];

      // Get BOQ items
      const items = await db
        .select()
        .from(boqItems)
        .where(eq(boqItems.boqId, boqId))
        .orderBy(asc(boqItems.lineNumber));

      // Get BOQ exceptions
      const exceptions = await db
        .select()
        .from(boqExceptions)
        .where(eq(boqExceptions.boqId, boqId))
        .orderBy(desc(boqExceptions.createdAt));

      // Log audit trail
      await auditLogger.logAction(context, 'view', 'boq', boqId, null, null, {
        itemCount: items.length,
        exceptionCount: exceptions.length
      });

      return this.service.success({
        ...boq,
        items,
        exceptions
      });
    } catch (error) {
      return this.service.handleError(error, 'getBOQById');
    }
  }

  /**
   * POST /api/v1/projects/{projectId}/boqs/import
   */
  async importBOQ(context: ApiContext, importData: any): Promise<ServiceResponse<{ boqId: string, itemCount: number, exceptionsCount: number }>> {
    try {
      // Validate import data
      const validation = validateSchema(ProcurementSchemas.BOQImport, importData);
      if (!validation.success) {
        return this.service.handleError(
          new RFQValidationError('Invalid BOQ import data', validation.error!.issues),
          'importBOQ'
        );
      }

      const validData = validation.data! as BOQImportData;

      // Create BOQ record
      const newBOQ: NewBOQ = {
        projectId: context.projectId,
        version: validData.version,
        title: validData.title,
        description: validData.description,
        status: 'draft',
        mappingStatus: 'pending',
        uploadedBy: context.userId,
        uploadedAt: new Date(),
        fileName: validData.fileName,
        fileSize: validData.fileSize,
        itemCount: validData.rows.length,
        unmappedItems: validData.rows.length,
        currency: 'ZAR'
      };

      const boqResult = await db.insert(boqs).values(newBOQ).returning();
      const boq = boqResult[0];

      // Create BOQ items
      const exceptionsCount = 0;
      const boqItemsToInsert: NewBOQItem[] = [];
      
      for (const row of validData.rows) {
        const newItem: NewBOQItem = {
          boqId: boq.id,
          projectId: context.projectId,
          lineNumber: row.lineNumber,
          itemCode: row.itemCode,
          description: row.description,
          category: row.category,
          subcategory: row.subcategory,
          quantity: row.quantity.toString(),
          uom: row.uom,
          unitPrice: row.unitPrice?.toString(),
          totalPrice: row.totalPrice?.toString(),
          phase: row.phase,
          task: row.task,
          site: row.site,
          location: row.location,
          specifications: row.specifications ? { notes: row.specifications } : undefined,
          technicalNotes: row.technicalNotes,
          mappingStatus: 'pending',
          procurementStatus: 'pending'
        };

        boqItemsToInsert.push(newItem);
      }

      await db.insert(boqItems).values(boqItemsToInsert);

      // Log audit trail
      await auditLogger.logAction(context, 'create', 'boq', boq.id, null, boq, {
        operation: 'import',
        fileName: validData.fileName,
        itemCount: validData.rows.length
      });

      return this.service.success({
        boqId: boq.id,
        itemCount: validData.rows.length,
        exceptionsCount
      });
    } catch (error) {
      return this.service.handleError(error, 'importBOQ');
    }
  }

  /**
   * PUT /api/v1/projects/{projectId}/boqs/{boqId}
   */
  async updateBOQ(context: ApiContext, boqId: string, updateData: Partial<BOQ>): Promise<ServiceResponse<BOQ>> {
    try {
      // Get current BOQ for audit trail
      const currentBOQ = await this.getBOQById(context, boqId);
      if (!currentBOQ.success) return currentBOQ as any;

      // Validate update data
      const allowedFields = ['title', 'description', 'status'];
      const filteredData = Object.keys(updateData)
        .filter(key => allowedFields.includes(key))
        .reduce((obj, key) => ({ ...obj, [key]: updateData[key as keyof BOQ] }), {});

      // Update BOQ
      const updatedBOQ = await db
        .update(boqs)
        .set({
          ...filteredData,
          updatedAt: new Date()
        })
        .where(and(eq(boqs.id, boqId), eq(boqs.projectId, context.projectId)))
        .returning();

      if (updatedBOQ.length === 0) {
        return this.service.handleError(new ProcurementError('BOQ not found or no changes made', 'BOQ_UPDATE_FAILED', 404), 'updateBOQ');
      }

      // Log audit trail
      await auditLogger.logAction(context, 'update', 'boq', boqId, currentBOQ.data, updatedBOQ[0], {
        updatedFields: Object.keys(filteredData)
      });

      return this.service.success(updatedBOQ[0]);
    } catch (error) {
      return this.service.handleError(error, 'updateBOQ');
    }
  }
}