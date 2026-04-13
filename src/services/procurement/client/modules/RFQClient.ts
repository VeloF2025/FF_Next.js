/**
 * RFQ Client Module
 * Request for Quotation operations for procurement client service
 */

import { procurementApi } from '@/services/api/procurementApi';
import type { RFQ } from '@/services/api/procurementApi';
import type { ProcurementApiContext } from '../../index';

export class RFQClient {
  static async getRFQList(
    context: ProcurementApiContext,
    filters?: Record<string, unknown>
  ): Promise<{ rfqs: RFQ[], total: number, page: number, limit: number }> {
    const response = await procurementApi.rfq.getRFQs(context.projectId, filters);
    return {
      rfqs: response.data,
      total: response.total,
      page: response.page,
      limit: response.limit
    };
  }

  static async getRFQById(
    context: ProcurementApiContext,
    rfqId: string
  ): Promise<RFQ> {
    return procurementApi.rfq.getRFQ(context.projectId, rfqId);
  }

  static async createRFQ(
    context: ProcurementApiContext,
    rfqData: Partial<RFQ>
  ): Promise<RFQ> {
    return procurementApi.rfq.createRFQ(context.projectId, {
      ...rfqData,
      createdBy: context.userId
    });
  }

  static async updateRFQ(
    context: ProcurementApiContext,
    rfqId: string,
    updateData: Partial<RFQ>
  ): Promise<RFQ> {
    return procurementApi.rfq.updateRFQ(context.projectId, rfqId, updateData);
  }

  static async deleteRFQ(
    context: ProcurementApiContext,
    rfqId: string
  ): Promise<void> {
    return procurementApi.rfq.deleteRFQ(context.projectId, rfqId);
  }
}
