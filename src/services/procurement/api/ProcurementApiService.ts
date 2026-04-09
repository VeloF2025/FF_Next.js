/**
 * Procurement API Service - Main service orchestrator
 * Implements secure, project-scoped API endpoints for BOQ, RFQ, and Stock management
 */

import { BaseService, type ServiceResponse, type ServiceOptions } from '../../core/BaseService';
import { ProcurementError } from '../procurementErrors';
import { projectAccessMiddleware } from '../middleware/projectAccessMiddleware';
import { rbacMiddleware } from '../middleware/rbacMiddleware';
import { db } from '@/lib/neon/connection';
// @ts-expect-error — module lacks type declarations
import { boqs } from '@/lib/neon/schema';
import { BOQOperations } from './boqOperations';
import { RFQOperations } from './rfqOperations';
import { StockOperations } from './stockOperations';
import type { ApiContext, HealthStatus, BOQFilters, RFQFilters, StockFilters, BOQImportData } from './types';

export class ProcurementApiService extends BaseService {
  private boqOps: BOQOperations;
  private rfqOps: RFQOperations;
  private stockOps: StockOperations;

  constructor(options: ServiceOptions = {}) {
    super('ProcurementAPI', {
      timeout: 45000, // Extended timeout for complex operations
      retries: 2,
      ...options,
    });

    // Initialize operation handlers
    this.boqOps = new BOQOperations(this);
    this.rfqOps = new RFQOperations(this);
    this.stockOps = new StockOperations();
  }

  // ==============================================
  // MIDDLEWARE VALIDATION
  // ==============================================

  /**
   * Validate API context and permissions
   */
  async validateContext(context: ApiContext, requiredPermission: string): Promise<ServiceResponse<null>> {
    try {
      // Check project access
      const projectAccess = await projectAccessMiddleware.checkProjectAccess(context.userId, context.projectId);
      if (!projectAccess.success) {
        return this.handleError(new ProcurementError('Access denied: Invalid project access', 'PROJECT_ACCESS_DENIED', 403), 'validateContext');
      }

      // Check RBAC permissions
      const rbacCheck = await rbacMiddleware.checkPermission(context.userId, requiredPermission, context.projectId);
      if (!rbacCheck.success) {
        return this.handleError(new ProcurementError('Access denied: Insufficient permissions', 'INSUFFICIENT_PERMISSIONS', 403), 'validateContext');
      }

      return this.success(null);
    } catch (error) {
      return this.handleError(error, 'validateContext');
    }
  }

  // ==============================================
  // BOQ MANAGEMENT ENDPOINTS
  // ==============================================

  async getBOQList(context: ApiContext, filters?: BOQFilters) {
    const authCheck = await this.validateContext(context, 'boq:read');
    if (!authCheck.success) return authCheck as ServiceResponse<never>;
    return this.boqOps.getBOQList(context, filters);
  }

  async getBOQById(context: ApiContext, boqId: string) {
    const authCheck = await this.validateContext(context, 'boq:read');
    if (!authCheck.success) return authCheck as ServiceResponse<never>;
    return this.boqOps.getBOQById(context, boqId);
  }

  async getBOQs(context: ApiContext, filters?: BOQFilters) {
    const authCheck = await this.validateContext(context, 'boq:read');
    if (!authCheck.success) return authCheck as ServiceResponse<never>;
    return this.boqOps.getBOQList(context, filters);
  }

  async importBOQ(context: ApiContext, importData: BOQImportData) {
    const authCheck = await this.validateContext(context, 'boq:create');
    if (!authCheck.success) return authCheck as ServiceResponse<never>;
    return this.boqOps.importBOQ(context, importData);
  }

  async updateBOQ(context: ApiContext, boqId: string, updateData: Record<string, unknown>) {
    const authCheck = await this.validateContext(context, 'boq:write');
    if (!authCheck.success) return authCheck as ServiceResponse<never>;
    return this.boqOps.updateBOQ(context, boqId, updateData);
  }

  // ==============================================
  // RFQ MANAGEMENT ENDPOINTS
  // ==============================================

  async getRFQList(context: ApiContext, filters?: RFQFilters) {
    const authCheck = await this.validateContext(context, 'rfq:read');
    if (!authCheck.success) return authCheck as ServiceResponse<never>;
    return this.rfqOps.getRFQList(context, filters);
  }

  async getRFQById(context: ApiContext, rfqId: string) {
    const authCheck = await this.validateContext(context, 'rfq:read');
    if (!authCheck.success) return authCheck as ServiceResponse<never>;
    return this.rfqOps.getRFQById(context, rfqId);
  }

  async createRFQ(context: ApiContext, rfqData: Record<string, unknown>) {
    const authCheck = await this.validateContext(context, 'rfq:create');
    if (!authCheck.success) return authCheck as ServiceResponse<never>;
    return this.rfqOps.createRFQ(context, rfqData);
  }

  async updateRFQ(context: ApiContext, rfqId: string, updateData: Record<string, unknown>) {
    const authCheck = await this.validateContext(context, 'rfq:write');
    if (!authCheck.success) return authCheck as ServiceResponse<never>;
    return this.rfqOps.updateRFQ(context, rfqId, updateData);
  }

  async deleteRFQ(context: ApiContext, rfqId: string) {
    const authCheck = await this.validateContext(context, 'rfq:delete');
    if (!authCheck.success) return authCheck as ServiceResponse<never>;
    return this.rfqOps.deleteRFQ(context, rfqId);
  }

  async addSuppliersToRFQ(context: ApiContext, rfqId: string, supplierIds: string[]) {
    const authCheck = await this.validateContext(context, 'rfq:write');
    if (!authCheck.success) return authCheck as ServiceResponse<never>;
    return this.rfqOps.addSuppliersToRFQ(context, rfqId, supplierIds);
  }

  async removeSuppliersFromRFQ(context: ApiContext, rfqId: string, supplierIds: string[]) {
    const authCheck = await this.validateContext(context, 'rfq:write');
    if (!authCheck.success) return authCheck as ServiceResponse<never>;
    return this.rfqOps.removeSuppliersFromRFQ(context, rfqId, supplierIds);
  }

  async replaceRFQSuppliers(context: ApiContext, rfqId: string, supplierIds: string[]) {
    const authCheck = await this.validateContext(context, 'rfq:write');
    if (!authCheck.success) return authCheck as ServiceResponse<never>;
    return this.rfqOps.replaceRFQSuppliers(context, rfqId, supplierIds);
  }

  async getSupplierRFQHistory(context: ApiContext, supplierId: string, filters?: RFQFilters) {
    const authCheck = await this.validateContext(context, 'rfq:read');
    if (!authCheck.success) return authCheck as ServiceResponse<never>;
    return this.rfqOps.getSupplierRFQHistory(context, supplierId, filters);
  }

  // ==============================================
  // STOCK MANAGEMENT ENDPOINTS
  // ==============================================

  async getStockPositions(context: ApiContext, filters?: StockFilters) {
    const authCheck = await this.validateContext(context, 'stock:read');
    if (!authCheck.success) return authCheck as ServiceResponse<never>;
    return this.stockOps.getStockPositions(context, filters);
  }

  // ==============================================
  // HEALTH CHECK
  // ==============================================

  async getHealthStatus(): Promise<ServiceResponse<HealthStatus>> {
    try {
      // Test database connection
      await db.select({ count: boqs.id }).from(boqs).limit(1);
      
      return this.success({
        status: 'healthy',
        details: {
          database: 'connected',
          timestamp: new Date().toISOString(),
          tablesAccessible: ['boqs', 'rfqs', 'stock_positions']
        }
      });
    } catch (error) {
      return {
        success: true,
        data: {
          status: 'unhealthy',
          details: {
            database: 'connection_failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
          }
        }
      };
    }
  }
}