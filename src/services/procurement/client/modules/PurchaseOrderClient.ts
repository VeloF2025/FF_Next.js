/**
 * Purchase Order Client Module
 * Purchase Order operations for procurement client service
 */

import { procurementApi } from '@/services/api/procurementApi';
import type { PurchaseOrder } from '@/services/api/procurementApi';
import type { ProcurementApiContext } from '../../index';

export class PurchaseOrderClient {
  static async getPurchaseOrders(
    context: ProcurementApiContext,
    filters?: Record<string, unknown>
  ): Promise<{ orders: PurchaseOrder[], total: number, page: number, limit: number }> {
    const response = await procurementApi.purchaseOrders.getOrders(context.projectId, filters);
    return {
      orders: response.data,
      total: response.total,
      page: response.page,
      limit: response.limit
    };
  }

  static async getPurchaseOrderById(
    context: ProcurementApiContext,
    orderId: string
  ): Promise<PurchaseOrder> {
    return procurementApi.purchaseOrders.getOrder(context.projectId, orderId);
  }

  static async createPurchaseOrder(
    context: ProcurementApiContext,
    orderData: Partial<PurchaseOrder>
  ): Promise<PurchaseOrder> {
    return procurementApi.purchaseOrders.createOrder(context.projectId, {
      ...orderData,
      createdBy: context.userId
    });
  }

  static async updatePurchaseOrder(
    context: ProcurementApiContext,
    orderId: string,
    updateData: Partial<PurchaseOrder>
  ): Promise<PurchaseOrder> {
    return procurementApi.purchaseOrders.updateOrder(context.projectId, orderId, updateData);
  }

  static async deletePurchaseOrder(
    context: ProcurementApiContext,
    orderId: string
  ): Promise<void> {
    return procurementApi.purchaseOrders.deleteOrder(context.projectId, orderId);
  }
}
