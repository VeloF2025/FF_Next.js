/**
 * StockQueryService - Read operations for stock management
 * Handles all query operations with filtering, pagination, and caching
 */

import { BaseService, type ServiceResponse } from '../../../core/BaseService';
import { db } from '@/lib/neon/connection';
// @ts-ignore
import { stockPositions, stockMovements, stockMovementItems, cableDrums, drumUsageHistory } from '@/lib/neon/schema/procurement/stock.schema';
// @ts-ignore
import { eq, and, desc, asc, gte, lte, like, count, sum, sql } from 'drizzle-orm';
import type {
  StockPosition,
  StockMovement,
  StockMovementItem,
  CableDrum,
  DrumUsageHistory,
  MovementTypeType,
  StockStatusType
} from '@/types/procurement/stock';
import type { StockFilters, MovementFilters, StockDashboardData } from '../StockService';

export class StockQueryService extends BaseService {
  constructor() {
    super('StockQueryService', {
      timeout: 30000,
      retries: 2,
      cache: true,
      cacheTTL: 60000, // 1 minute cache for read operations
    });
  }

  /**
   * Get health status of query service
   */
  async getHealthStatus(): Promise<ServiceResponse<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details?: Record<string, unknown>;
  }>> {
    try {
      // Test basic query
      await db.select().from(stockPositions).limit(1);
      
      return this.success({
        status: 'healthy',
        details: {
          connectionStatus: 'active',
          queryCapabilities: 'operational',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      return this.success({
        status: 'unhealthy',
        details: {
          connectionStatus: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  // 🟢 WORKING: Stock Position Queries
  async getStockPositions(
    projectId: string,
    filters: StockFilters = {}
  ): Promise<ServiceResponse<{ positions: StockPosition[], total: number, page: number, limit: number }>> {
    try {
      const { page = 1, limit = 50, sortBy = 'itemCode', sortOrder = 'asc' } = filters;
      const offset = (page - 1) * limit;

      // Build filter conditions
      const queryConditions = [eq(stockPositions.projectId, projectId)];
      
      if (filters.category) {
        queryConditions.push(eq(stockPositions.category, filters.category));
      }
      
      if (filters.stockStatus) {
        queryConditions.push(eq(stockPositions.stockStatus, filters.stockStatus));
      }
      
      if (filters.warehouseLocation) {
        queryConditions.push(eq(stockPositions.warehouseLocation, filters.warehouseLocation));
      }
      
      if (filters.binLocation) {
        queryConditions.push(eq(stockPositions.binLocation, filters.binLocation));
      }
      
      if (filters.itemCode) {
        queryConditions.push(like(stockPositions.itemCode, `%${filters.itemCode}%`));
      }
      
      if (filters.lowStock) {
        queryConditions.push(
          sql`${stockPositions.availableQuantity} <= ${stockPositions.reorderLevel}`
        );
      }

      // Determine sort column
      const sortColumn = this.getSortColumn(sortBy);
      const orderBy = sortOrder === 'desc' ? desc(sortColumn) : asc(sortColumn);

      // Execute main query
      const positions = await db
        .select()
        .from(stockPositions)
        .where(and(...queryConditions))
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset);

      // Get total count
      const [totalResult] = await db
        .select({ count: count() })
        .from(stockPositions)
        .where(and(...queryConditions));

      const total = totalResult?.count || 0;

      return this.success({
        positions: positions.map(this.mapStockPosition),
        total,
        page,
        limit,
      });
    } catch (error) {
      return this.handleError(error, 'getStockPositions');
    }
  }

  async getStockPositionById(
    positionId: string,
    projectId: string
  ): Promise<ServiceResponse<StockPosition>> {
    try {
      const [position] = await db
        .select()
        .from(stockPositions)
        .where(
          and(
            eq(stockPositions.id, positionId),
            eq(stockPositions.projectId, projectId)
          )
        )
        .limit(1);

      if (!position) {
        return {
          success: false,
          error: 'Stock position not found',
          code: 'NOT_FOUND',
        };
      }

      return this.success(this.mapStockPosition(position));
    } catch (error) {
      return this.handleError(error, 'getStockPositionById');
    }
  }

  async getStockPositionByItemCode(
    itemCode: string,
    projectId: string
  ): Promise<ServiceResponse<StockPosition | null>> {
    try {
      const [position] = await db
        .select()
        .from(stockPositions)
        .where(
          and(
            eq(stockPositions.itemCode, itemCode),
            eq(stockPositions.projectId, projectId)
          )
        )
        .limit(1);

      return this.success(position ? this.mapStockPosition(position) : null);
    } catch (error) {
      return this.handleError(error, 'getStockPositionByItemCode');
    }
  }

  // 🟢 WORKING: Stock Movement Queries
  async getStockMovements(
    projectId: string,
    filters: MovementFilters = {}
  ): Promise<ServiceResponse<{ movements: StockMovement[], total: number, page: number, limit: number }>> {
    try {
      const { page = 1, limit = 50, sortBy = 'movementDate', sortOrder = 'desc' } = filters;
      const offset = (page - 1) * limit;

      // Build filter conditions
      const queryConditions = [eq(stockMovements.projectId, projectId)];
      
      if (filters.movementType) {
        queryConditions.push(eq(stockMovements.movementType, filters.movementType));
      }
      
      if (filters.status) {
        queryConditions.push(eq(stockMovements.status, filters.status));
      }
      
      if (filters.referenceNumber) {
        queryConditions.push(like(stockMovements.referenceNumber, `%${filters.referenceNumber}%`));
      }
      
      if (filters.fromDate) {
        queryConditions.push(gte(stockMovements.movementDate, filters.fromDate));
      }
      
      if (filters.toDate) {
        queryConditions.push(lte(stockMovements.movementDate, filters.toDate));
      }

      // Determine sort column
      const sortColumn = this.getMovementSortColumn(sortBy);
      const orderBy = sortOrder === 'desc' ? desc(sortColumn) : asc(sortColumn);

      // Execute main query
      const movements = await db
        .select()
        .from(stockMovements)
        .where(and(...queryConditions))
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset);

      // Get total count
      const [totalResult] = await db
        .select({ count: count() })
        .from(stockMovements)
        .where(and(...queryConditions));

      const total = totalResult?.count || 0;

      return this.success({
        movements: movements.map(this.mapStockMovement),
        total,
        page,
        limit,
      });
    } catch (error) {
      return this.handleError(error, 'getStockMovements');
    }
  }

  async getStockMovementById(
    movementId: string,
    projectId: string
  ): Promise<ServiceResponse<StockMovement & { items: StockMovementItem[] }>> {
    try {
      // Get movement details
      const [movement] = await db
        .select()
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.id, movementId),
            eq(stockMovements.projectId, projectId)
          )
        )
        .limit(1);

      if (!movement) {
        return {
          success: false,
          error: 'Stock movement not found',
          code: 'NOT_FOUND',
        };
      }

      // Get movement items
      const items = await db
        .select()
        .from(stockMovementItems)
        .where(eq(stockMovementItems.stockMovementId, movementId))
        .orderBy(asc(stockMovementItems.itemCode));

      return this.success({
        ...this.mapStockMovement(movement),
        items: items.map(this.mapStockMovementItem),
      });
    } catch (error) {
      return this.handleError(error, 'getStockMovementById');
    }
  }

  // 🟢 WORKING: Cable Drum Queries
  async getCableDrums(
    projectId: string,
    filters: { 
      page?: number; 
      limit?: number; 
      cableType?: string; 
      installationStatus?: string; 
      currentLocation?: string; 
    } = {}
  ): Promise<ServiceResponse<{ drums: CableDrum[], total: number, page: number, limit: number }>> {
    try {
      const { page = 1, limit = 50 } = filters;
      const offset = (page - 1) * limit;

      // Build filter conditions
      const queryConditions = [eq(cableDrums.projectId, projectId)];
      
      if (filters.cableType) {
        queryConditions.push(eq(cableDrums.cableType, filters.cableType));
      }
      
      if (filters.installationStatus) {
        queryConditions.push(eq(cableDrums.installationStatus, filters.installationStatus));
      }
      
      if (filters.currentLocation) {
        queryConditions.push(eq(cableDrums.currentLocation, filters.currentLocation));
      }

      // Execute main query
      const drums = await db
        .select()
        .from(cableDrums)
        .where(and(...queryConditions))
        .orderBy(desc(cableDrums.createdAt))
        .limit(limit)
        .offset(offset);

      // Get total count
      const [totalResult] = await db
        .select({ count: count() })
        .from(cableDrums)
        .where(and(...queryConditions));

      const total = totalResult?.count || 0;

      return this.success({
        drums: drums.map(this.mapCableDrum),
        total,
        page,
        limit,
      });
    } catch (error) {
      return this.handleError(error, 'getCableDrums');
    }
  }

  async getDrumUsageHistory(
    drumId: string
  ): Promise<ServiceResponse<DrumUsageHistory[]>> {
    try {
      const usageHistory = await db
        .select()
        .from(drumUsageHistory)
        .where(eq(drumUsageHistory.drumId, drumId))
        .orderBy(desc(drumUsageHistory.usageDate));

      return this.success(usageHistory.map(this.mapDrumUsageHistory));
    } catch (error) {
      return this.handleError(error, 'getDrumUsageHistory');
    }
  }

  // 🟢 WORKING: Dashboard and Analytics Queries
  async getDashboardData(projectId: string): Promise<ServiceResponse<StockDashboardData>> {
    try {
      // Get basic stock statistics
      const [stockStats] = await db
        .select({
          totalItems: count(),
          totalValue: sum(stockPositions.totalValue),
        })
        .from(stockPositions)
        .where(
          and(
            eq(stockPositions.projectId, projectId),
            eq(stockPositions.isActive, true)
          )
        );

      // Get low stock and critical stock counts
      const [lowStockStats] = await db
        .select({
          lowStockItems: count(),
        })
        .from(stockPositions)
        .where(
          and(
            eq(stockPositions.projectId, projectId),
            eq(stockPositions.isActive, true),
            sql`${stockPositions.availableQuantity} <= ${stockPositions.reorderLevel}`
          )
        );

      const [criticalStockStats] = await db
        .select({
          criticalStockItems: count(),
        })
        .from(stockPositions)
        .where(
          and(
            eq(stockPositions.projectId, projectId),
            eq(stockPositions.isActive, true),
            eq(stockPositions.stockStatus, 'critical')
          )
        );

      // Get recent movements (last 10)
      const recentMovements = await db
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.projectId, projectId))
        .orderBy(desc(stockMovements.createdAt))
        .limit(10);

      // Get top categories
      const topCategories = await db
        .select({
          category: stockPositions.category,
          itemCount: count(),
          totalValue: sum(stockPositions.totalValue),
        })
        .from(stockPositions)
        .where(
          and(
            eq(stockPositions.projectId, projectId),
            eq(stockPositions.isActive, true)
          )
        )
        .groupBy(stockPositions.category)
        .orderBy(desc(sum(stockPositions.totalValue)))
        .limit(5);

      // Get stock level distribution
      const stockLevels = await db
        .select({
          stockStatus: stockPositions.stockStatus,
          count: count(),
        })
        .from(stockPositions)
        .where(
          and(
            eq(stockPositions.projectId, projectId),
            eq(stockPositions.isActive, true)
          )
        )
        .groupBy(stockPositions.stockStatus);

      // Calculate percentages for stock levels
      const totalItemsForPercentage = stockStats?.totalItems || 0;
      const stockLevelsWithPercentage = stockLevels.map((level: any) => ({
        status: level.stockStatus as StockStatusType,
        count: level.count,
        percentage: totalItemsForPercentage > 0 
          ? Math.round((level.count / totalItemsForPercentage) * 100)
          : 0,
      }));

      const dashboardData: StockDashboardData = {
        totalItems: stockStats?.totalItems || 0,
        totalValue: Number(stockStats?.totalValue) || 0,
        lowStockItems: lowStockStats?.lowStockItems || 0,
        criticalStockItems: criticalStockStats?.criticalStockItems || 0,
        recentMovements: recentMovements.map(this.mapStockMovement),
        topCategories: topCategories.map((cat: any) => ({
          category: cat.category || 'Uncategorized',
          itemCount: cat.itemCount,
          totalValue: Number(cat.totalValue) || 0,
        })),
        stockLevels: stockLevelsWithPercentage,
      };

      return this.success(dashboardData);
    } catch (error) {
      return this.handleError(error, 'getDashboardData');
    }
  }

  // 🟢 WORKING: Validation Queries
  async validateStockAvailability(
    projectId: string,
    itemCode: string,
    requiredQuantity: number
  ): Promise<ServiceResponse<{ available: boolean, availableQuantity: number, shortfall?: number }>> {
    try {
      const [position] = await db
        .select({
          availableQuantity: stockPositions.availableQuantity,
        })
        .from(stockPositions)
        .where(
          and(
            eq(stockPositions.projectId, projectId),
            eq(stockPositions.itemCode, itemCode),
            eq(stockPositions.isActive, true)
          )
        )
        .limit(1);

      if (!position) {
        return this.success({
          available: false,
          availableQuantity: 0,
          shortfall: requiredQuantity,
        });
      }

      const availableQuantity = Number(position.availableQuantity);
      const available = availableQuantity >= requiredQuantity;
      
      const result: { available: boolean; availableQuantity: number; shortfall?: number } = {
        available,
        availableQuantity
      };
      if (!available) {
        result.shortfall = requiredQuantity - availableQuantity;
      }
      return this.success(result);
    } catch (error) {
      return this.handleError(error, 'validateStockAvailability');
    }
  }

  // 🔵 HELPER: Mapping Functions
  private mapStockPosition(position: any): StockPosition {
    return {
      id: position.id,
      projectId: position.projectId,
      itemCode: position.itemCode,
      itemName: position.itemName,
      description: position.description,
      category: position.category,
      uom: position.uom,
      onHandQuantity: Number(position.onHandQuantity),
      reservedQuantity: Number(position.reservedQuantity),
      availableQuantity: Number(position.availableQuantity),
      inTransitQuantity: Number(position.inTransitQuantity),
      ...(position.averageUnitCost && { averageUnitCost: Number(position.averageUnitCost) }),
      ...(position.totalValue && { totalValue: Number(position.totalValue) }),
      warehouseLocation: position.warehouseLocation,
      binLocation: position.binLocation,
      ...(position.reorderLevel && { reorderLevel: Number(position.reorderLevel) }),
      ...(position.maxStockLevel && { maxStockLevel: Number(position.maxStockLevel) }),
      ...(position.economicOrderQuantity && { economicOrderQuantity: Number(position.economicOrderQuantity) }),
      lastMovementDate: position.lastMovementDate,
      lastCountDate: position.lastCountDate,
      nextCountDue: position.nextCountDue,
      isActive: position.isActive,
      stockStatus: position.stockStatus as StockStatusType,
      createdAt: position.createdAt,
      updatedAt: position.updatedAt,
    };
  }

  private mapStockMovement(movement: any): StockMovement {
    return {
      id: movement.id,
      projectId: movement.projectId,
      movementType: movement.movementType as MovementTypeType,
      referenceNumber: movement.referenceNumber,
      referenceType: movement.referenceType,
      referenceId: movement.referenceId,
      fromLocation: movement.fromLocation,
      toLocation: movement.toLocation,
      fromProjectId: movement.fromProjectId,
      toProjectId: movement.toProjectId,
      status: movement.status,
      movementDate: movement.movementDate,
      confirmedAt: movement.confirmedAt,
      requestedBy: movement.requestedBy,
      authorizedBy: movement.authorizedBy,
      processedBy: movement.processedBy,
      notes: movement.notes,
      reason: movement.reason,
      createdAt: movement.createdAt,
      updatedAt: movement.updatedAt,
    };
  }

  private mapStockMovementItem(item: any): StockMovementItem {
    return {
      id: item.id,
      movementId: item.stockMovementId,
      stockPositionId: item.stockPositionId,
      projectId: item.projectId,
      itemCode: item.itemCode,
      itemName: item.description || item.itemCode, // Fallback for itemName
      description: item.description,
      uom: item.uom,
      plannedQuantity: Number(item.plannedQuantity),
      ...(item.actualQuantity && { actualQuantity: Number(item.actualQuantity) }),
      ...(item.actualQuantity && { receivedQuantity: Number(item.actualQuantity) }), // Alias
      ...(item.unitCost && { unitCost: Number(item.unitCost) }),
      ...(item.totalCost && { totalCost: Number(item.totalCost) }),
      lotNumbers: item.lotNumbers || [],
      serialNumbers: item.serialNumbers || [],
      itemStatus: item.itemStatus,
      qualityCheckRequired: item.qualityCheckRequired,
      qualityCheckStatus: item.qualityCheckStatus,
      qualityNotes: item.qualityCheckNotes,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private mapCableDrum(drum: any): CableDrum {
    return {
      id: drum.id,
      projectId: drum.projectId,
      stockPositionId: drum.stockPositionId,
      drumNumber: drum.drumNumber,
      serialNumber: drum.serialNumber,
      supplierDrumId: drum.supplierDrumId,
      cableType: drum.cableType,
      cableSpecification: drum.cableSpecification,
      manufacturerName: drum.manufacturerName,
      partNumber: drum.partNumber,
      originalLength: Number(drum.originalLength),
      currentLength: Number(drum.currentLength),
      usedLength: Number(drum.usedLength),
      ...(drum.drumWeight && { drumWeight: Number(drum.drumWeight) }),
      ...(drum.cableWeight && { cableWeight: Number(drum.cableWeight) }),
      ...(drum.drumDiameter && { drumDiameter: Number(drum.drumDiameter) }),
      currentLocation: drum.currentLocation,
      drumCondition: drum.drumCondition,
      installationStatus: drum.installationStatus,
      ...(drum.lastMeterReading && { lastMeterReading: Number(drum.lastMeterReading) }),
      lastReadingDate: drum.lastReadingDate,
      lastUsedDate: drum.lastUsedDate,
      testCertificate: drum.testCertificate,
      installationNotes: drum.installationNotes,
      createdAt: drum.createdAt,
      updatedAt: drum.updatedAt,
    };
  }

  private mapDrumUsageHistory(usage: any): DrumUsageHistory {
    return {
      id: usage.id,
      drumId: usage.drumId,
      projectId: usage.projectId,
      usageDate: usage.usageDate,
      previousReading: Number(usage.previousReading),
      currentReading: Number(usage.currentReading),
      usedLength: Number(usage.usedLength),
      poleNumber: usage.poleNumber,
      sectionId: usage.sectionId,
      workOrderId: usage.workOrderId,
      technicianId: usage.technicianId,
      installationType: usage.installationType,
      startCoordinates: usage.startCoordinates,
      endCoordinates: usage.endCoordinates,
      installationNotes: usage.installationNotes,
      qualityNotes: usage.qualityNotes,
      createdAt: usage.createdAt,
    };
  }

  private getSortColumn(sortBy: string) {
    const sortMap: Record<string, any> = {
      itemCode: stockPositions.itemCode,
      itemName: stockPositions.itemName,
      category: stockPositions.category,
      onHandQuantity: stockPositions.onHandQuantity,
      availableQuantity: stockPositions.availableQuantity,
      stockStatus: stockPositions.stockStatus,
      lastMovementDate: stockPositions.lastMovementDate,
      createdAt: stockPositions.createdAt,
    };
    return sortMap[sortBy] || stockPositions.itemCode;
  }

  private getMovementSortColumn(sortBy: string) {
    const sortMap: Record<string, any> = {
      movementDate: stockMovements.movementDate,
      referenceNumber: stockMovements.referenceNumber,
      movementType: stockMovements.movementType,
      status: stockMovements.status,
      createdAt: stockMovements.createdAt,
    };
    return sortMap[sortBy] || stockMovements.movementDate;
  }
}

export default StockQueryService;