/**
 * RFQ API Operations - Main Interface
 * Orchestrates all RFQ-related API operations through modular components
 */

import { BaseService, type ServiceResponse } from '../../core/BaseService';
// @ts-ignore
import type { RFQ } from '@/lib/neon/schema';
import type { ApiContext, RFQFilters } from './types';
import { RFQCrudOperations } from './rfq-crud-operations';
import { RFQSupplierOperations } from './rfq-supplier-operations';
import { RFQQueryOperations } from './rfq-query-operations';

export class RFQOperations {
  private crudOps: RFQCrudOperations;
  private supplierOps: RFQSupplierOperations;
  private queryOps: RFQQueryOperations;

  constructor(service: BaseService) {
    this.crudOps = new RFQCrudOperations(service);
    this.supplierOps = new RFQSupplierOperations(service);
    this.queryOps = new RFQQueryOperations(service);
  }

  /**
   * GET /api/v1/projects/{projectId}/rfqs
   */
  async getRFQList(context: ApiContext, filters: RFQFilters = {}): Promise<ServiceResponse<{ rfqs: RFQ[], total: number, page: number, limit: number }>> {
    return this.queryOps.getRFQList(context, filters);
  }

  /**
   * GET /api/v1/projects/{projectId}/rfqs/{rfqId}
   */
  async getRFQById(context: ApiContext, rfqId: string): Promise<ServiceResponse<RFQ>> {
    return this.crudOps.getRFQById(context, rfqId);
  }

  /**
   * POST /api/v1/projects/{projectId}/rfqs
   */
  async createRFQ(context: ApiContext, rfqData: unknown): Promise<ServiceResponse<RFQ>> {
    return this.crudOps.createRFQ(context, rfqData);
  }

  /**
   * PUT /api/v1/projects/{projectId}/rfqs/{rfqId}
   */
  async updateRFQ(context: ApiContext, rfqId: string, updateData: unknown): Promise<ServiceResponse<RFQ>> {
    return this.crudOps.updateRFQ(context, rfqId, updateData);
  }

  /**
   * DELETE /api/v1/projects/{projectId}/rfqs/{rfqId}
   */
  async deleteRFQ(context: ApiContext, rfqId: string): Promise<ServiceResponse<void>> {
    return this.crudOps.deleteRFQ(context, rfqId);
  }

  /**
   * POST /api/v1/projects/{projectId}/rfqs/{rfqId}/suppliers
   */
  async addSuppliersToRFQ(context: ApiContext, rfqId: string, supplierIds: string[]): Promise<ServiceResponse<void>> {
    return this.supplierOps.addSuppliersToRFQ(context, rfqId, supplierIds);
  }

  /**
   * DELETE /api/v1/projects/{projectId}/rfqs/{rfqId}/suppliers
   */
  async removeSuppliersFromRFQ(context: ApiContext, rfqId: string, supplierIds: string[]): Promise<ServiceResponse<void>> {
    return this.supplierOps.removeSuppliersFromRFQ(context, rfqId, supplierIds);
  }

  /**
   * PUT /api/v1/projects/{projectId}/rfqs/{rfqId}/suppliers
   */
  async replaceRFQSuppliers(context: ApiContext, rfqId: string, supplierIds: string[]): Promise<ServiceResponse<void>> {
    return this.supplierOps.replaceRFQSuppliers(context, rfqId, supplierIds);
  }

  /**
   * GET /api/v1/projects/{projectId}/suppliers/{supplierId}/rfqs
   */
  async getSupplierRFQHistory(context: ApiContext, supplierId: string, filters: RFQFilters = {}): Promise<ServiceResponse<{ rfqs: RFQ[], total: number }>> {
    return this.queryOps.getSupplierRFQHistory(context, supplierId, filters);
  }
}

// Re-export modular components for direct access
export { RFQCrudOperations } from './rfq-crud-operations';
export { RFQSupplierOperations } from './rfq-supplier-operations';
export { RFQQueryOperations } from './rfq-query-operations';