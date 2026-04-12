/**
 * Stock Client Module
 * Stock operations for procurement client service
 */

import { procurementApi } from '@/services/api/procurementApi';
import type { StockPosition, StockMovement, StockMovementItem, StockDashboard } from '@/services/api/procurementApi';
import type { ProcurementApiContext } from '../../index';

interface StockPositionFilters {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  category?: string;
  stockStatus?: string;
  warehouseLocation?: string;
  binLocation?: string;
  itemCode?: string;
  lowStock?: boolean;
}

interface StockMovementFilters {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  movementType?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  referenceNumber?: string;
}

interface BulkMovementData {
  movementType: string;
  referenceNumber: string;
  referenceType?: string;
  referenceId?: string;
  fromLocation?: string;
  toLocation?: string;
  fromProjectId?: string;
  toProjectId?: string;
  notes?: string;
  reason?: string;
  items: Array<{
    itemCode: string;
    itemName?: string;
    plannedQuantity: number;
    unitCost?: number;
    lotNumbers?: string[];
    serialNumbers?: string[];
  }>;
}

export class StockClient {
  static async getStockPositions(
    context: ProcurementApiContext,
    filters?: StockPositionFilters
  ): Promise<{ positions: StockPosition[], total: number, page: number, limit: number }> {
    const response = await procurementApi.stock.getPositions(context.projectId, filters);
    return {
      positions: response.data,
      total: response.total,
      page: response.page,
      limit: response.limit
    };
  }

  static async getStockPositionById(
    context: ProcurementApiContext,
    positionId: string
  ): Promise<StockPosition> {
    return procurementApi.stock.getPosition(context.projectId, positionId);
  }

  static async createStockPosition(
    context: ProcurementApiContext,
    positionData: Partial<StockPosition>
  ): Promise<StockPosition> {
    return procurementApi.stock.createPosition(context.projectId, positionData);
  }

  static async updateStockPosition(
    context: ProcurementApiContext,
    positionId: string,
    updateData: Partial<StockPosition>
  ): Promise<StockPosition> {
    return procurementApi.stock.updatePosition(context.projectId, positionId, updateData);
  }

  static async getStockMovements(
    context: ProcurementApiContext,
    filters?: StockMovementFilters
  ): Promise<{ movements: StockMovement[], total: number, page: number, limit: number }> {
    const response = await procurementApi.stock.getMovements(context.projectId, filters);
    return {
      movements: response.data,
      total: response.total,
      page: response.page,
      limit: response.limit
    };
  }

  static async createStockMovement(
    context: ProcurementApiContext,
    movementData: Partial<StockMovement>
  ): Promise<StockMovement> {
    return procurementApi.stock.createMovement(context.projectId, movementData);
  }

  static async processBulkMovement(
    context: ProcurementApiContext,
    bulkMovementData: BulkMovementData
  ): Promise<{ movement: StockMovement, items: StockMovementItem[] }> {
    return procurementApi.stock.processBulkMovement(context.projectId, {
      ...bulkMovementData,
      userId: context.userId
    });
  }

  static async getDashboardData(
    context: ProcurementApiContext
  ): Promise<StockDashboard> {
    return procurementApi.stock.getDashboard(context.projectId);
  }
}
