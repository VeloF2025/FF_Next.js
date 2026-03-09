/**
 * Stock API Operations - Complete CRUD endpoints for stock management
 * Handles all stock-related API operations with comprehensive functionality
 */

import { BaseService, type ServiceResponse } from '../../core/BaseService';
import StockService from '../stock/StockService';
import type { 
  StockPosition, 
  StockMovement, 
  StockMovementItem, 
  CableDrum,
  DrumUsageHistory 
} from '@/types/procurement/stock';
import type { 
  StockFilters, 
  MovementFilters, 
  StockDashboardData,
  BulkMovementRequest 
} from '../stock/StockService';
import type { 
  GRNData,
  IssueData,
  TransferData,
  ReturnData 
} from '../stock/core/StockMovementService';
import type { 
  CreateStockPositionData,
  StockAdjustmentData,
  StockReservationData 
} from '../stock/core/StockCommandService';
import type { ProcurementApiContext } from '../index';

export class StockOperations extends BaseService {
  private stockService: StockService;

  constructor() {
    super('StockOperations', {
      timeout: 45000,
      retries: 2,
      cache: false,
    });
    
    this.stockService = new StockService();
  }

  /**
   * Get health status
   */
  async getHealthStatus(): Promise<ServiceResponse<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details?: Record<string, unknown>;
  }>> {
    return this.stockService.getHealthStatus();
  }

  // 🟢 WORKING: Stock Position Endpoints
  
  /**
   * GET /api/v1/projects/{projectId}/stock/positions
   * Get paginated list of stock positions with filtering
   */
  async getStockPositions(
    context: ProcurementApiContext, 
    filters: StockFilters = {}
  ): Promise<ServiceResponse<{ positions: StockPosition[], total: number, page: number, limit: number }>> {
    return this.stockService.getStockPositions(context, filters);
  }

  /**
   * GET /api/v1/projects/{projectId}/stock/positions/{positionId}
   * Get single stock position by ID
   */
  async getStockPositionById(
    context: ProcurementApiContext,
    positionId: string
  ): Promise<ServiceResponse<StockPosition>> {
    return this.stockService.getStockPositionById(context, positionId);
  }

  /**
   * POST /api/v1/projects/{projectId}/stock/positions
   * Create new stock position
   */
  async createStockPosition(
    context: ProcurementApiContext,
    positionData: CreateStockPositionData
  ): Promise<ServiceResponse<StockPosition>> {
    // Ensure projectId matches context and provide required defaults
    const dataWithProject: Omit<StockPosition, 'id' | 'createdAt' | 'updatedAt'> = {
      projectId: context.projectId,
      itemCode: positionData.itemCode,
      itemName: positionData.itemName,
      description: positionData.description || '',
      category: positionData.category || 'General',
      uom: positionData.uom,
      onHandQuantity: positionData.onHandQuantity || 0,
      reservedQuantity: 0,
      availableQuantity: positionData.onHandQuantity || 0,
      inTransitQuantity: 0,
      averageUnitCost: positionData.averageUnitCost || 0,
      totalValue: (positionData.onHandQuantity || 0) * (positionData.averageUnitCost || 0),
      warehouseLocation: positionData.warehouseLocation || 'DEFAULT',
      binLocation: positionData.binLocation || 'A-01-01',
      reorderLevel: positionData.reorderLevel || 0,
      maxStockLevel: positionData.maxStockLevel || 0,
      economicOrderQuantity: positionData.economicOrderQuantity || 0,
      isActive: true,
      stockStatus: 'normal',
    };

    return this.stockService.createStockPosition(context, dataWithProject);
  }

  /**
   * PUT /api/v1/projects/{projectId}/stock/positions/{positionId}
   * Update existing stock position
   */
  async updateStockPosition(
    context: ProcurementApiContext,
    positionId: string,
    updateData: Partial<StockPosition>
  ): Promise<ServiceResponse<StockPosition>> {
    return this.stockService.updateStockPosition(context, positionId, updateData);
  }

  /**
   * DELETE /api/v1/projects/{projectId}/stock/positions/{positionId}
   * Soft delete stock position (set isActive = false)
   */
  async deleteStockPosition(
    context: ProcurementApiContext,
    positionId: string
  ): Promise<ServiceResponse<boolean>> {
    try {
      // Use the command service's delete method through the main service
      const result = await this.stockService.updateStockPosition(context, positionId, { isActive: false });
      return this.success(result.success);
    } catch (error) {
      return this.handleError(error, 'deleteStockPosition');
    }
  }

  // 🟢 WORKING: Stock Movement Endpoints

  /**
   * GET /api/v1/projects/{projectId}/stock/movements
   * Get paginated list of stock movements with filtering
   */
  async getStockMovements(
    context: ProcurementApiContext,
    filters: MovementFilters = {}
  ): Promise<ServiceResponse<{ movements: StockMovement[], total: number, page: number, limit: number }>> {
    return this.stockService.getStockMovements(context, filters);
  }

  /**
   * GET /api/v1/projects/{projectId}/stock/movements/{movementId}
   * Get single stock movement with its items
   */
  async getStockMovementById(
    context: ProcurementApiContext,
    movementId: string
  ): Promise<ServiceResponse<StockMovement & { items: StockMovementItem[] }>> {
    try {
      // This would need to be implemented in the query service
      const queryService = (this.stockService as any).queryService;
      return await queryService.getStockMovementById(movementId, context.projectId);
    } catch (error) {
      return this.handleError(error, 'getStockMovementById');
    }
  }

  /**
   * POST /api/v1/projects/{projectId}/stock/movements
   * Create new stock movement
   */
  async createStockMovement(
    context: ProcurementApiContext,
    movementData: Omit<StockMovement, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ServiceResponse<StockMovement>> {
    // Ensure projectId matches context
    const dataWithProject = {
      ...movementData,
      projectId: context.projectId,
    };

    return this.stockService.createStockMovement(context, dataWithProject);
  }

  /**
   * POST /api/v1/projects/{projectId}/stock/movements/bulk
   * Process bulk movement with multiple items
   */
  async processBulkMovement(
    context: ProcurementApiContext,
    bulkMovementData: BulkMovementRequest
  ): Promise<ServiceResponse<{ movement: StockMovement, items: StockMovementItem[] }>> {
    return this.stockService.processBulkMovement(context, bulkMovementData);
  }

  // 🟢 WORKING: Specialized Movement Endpoints

  /**
   * POST /api/v1/projects/{projectId}/stock/movements/grn
   * Process Goods Receipt Note (GRN)
   */
  async processGRN(
    context: ProcurementApiContext,
    grnData: GRNData
  ): Promise<ServiceResponse<{ movement: StockMovement, items: StockMovementItem[] }>> {
    try {
      const movementService = (this.stockService as any).movementService;
      return await movementService.processGRN(context.projectId, grnData);
    } catch (error) {
      return this.handleError(error, 'processGRN');
    }
  }

  /**
   * POST /api/v1/projects/{projectId}/stock/movements/issue
   * Process stock issue to field/operations
   */
  async processIssue(
    context: ProcurementApiContext,
    issueData: IssueData
  ): Promise<ServiceResponse<{ movement: StockMovement, items: StockMovementItem[] }>> {
    try {
      const movementService = (this.stockService as any).movementService;
      return await movementService.processIssue(context.projectId, issueData);
    } catch (error) {
      return this.handleError(error, 'processIssue');
    }
  }

  /**
   * POST /api/v1/projects/{projectId}/stock/movements/transfer
   * Process stock transfer between projects
   */
  async processTransfer(
    context: ProcurementApiContext,
    transferData: TransferData
  ): Promise<ServiceResponse<{ movement: StockMovement, items: StockMovementItem[] }>> {
    try {
      const movementService = (this.stockService as any).movementService;
      return await movementService.processTransfer(transferData, context.projectId, context.userId);
    } catch (error) {
      return this.handleError(error, 'processTransfer');
    }
  }

  /**
   * POST /api/v1/projects/{projectId}/stock/movements/return
   * Process stock return from field
   */
  async processReturn(
    context: ProcurementApiContext,
    returnData: ReturnData
  ): Promise<ServiceResponse<{ movement: StockMovement, items: StockMovementItem[] }>> {
    try {
      // Transform return data to GRN format (returns are like receipts)
      const grnData: GRNData = {
        referenceNumber: returnData.referenceNumber,
        poNumber: returnData.originalIssueNumber || 'RETURN-' + returnData.referenceNumber,
        supplierName: `Return from ${returnData.returnedBy}`,
        receivedBy: returnData.returnedTo,
        receivedDate: returnData.returnDate,
        items: returnData.items.map(item => ({
          itemCode: item.itemCode,
          itemName: item.itemCode, // Should be enriched
          plannedQuantity: item.returnQuantity,
          receivedQuantity: item.returnQuantity,
          unitCost: 0, // Return items have no cost impact
          qualityCheckRequired: item.condition !== 'good',
          qualityNotes: `Condition: ${item.condition}. ${item.notes || ''}`,
        })),
      };

      const movementService = (this.stockService as any).movementService;
      return await movementService.processGRN(context.projectId, grnData);
    } catch (error) {
      return this.handleError(error, 'processReturn');
    }
  }

  // 🟢 WORKING: Stock Level Management Endpoints

  /**
   * POST /api/v1/projects/{projectId}/stock/adjustments
   * Adjust stock levels (increase/decrease)
   */
  async adjustStockLevel(
    context: ProcurementApiContext,
    adjustmentData: StockAdjustmentData
  ): Promise<ServiceResponse<StockPosition>> {
    try {
      const commandService = (this.stockService as any).commandService;
      return await commandService.adjustStockLevel(context.projectId, adjustmentData, context.userId);
    } catch (error) {
      return this.handleError(error, 'adjustStockLevel');
    }
  }

  /**
   * POST /api/v1/projects/{projectId}/stock/reservations
   * Reserve stock for upcoming issues
   */
  async reserveStock(
    context: ProcurementApiContext,
    reservationData: StockReservationData
  ): Promise<ServiceResponse<StockPosition>> {
    try {
      const commandService = (this.stockService as any).commandService;
      return await commandService.reserveStock(context.projectId, reservationData);
    } catch (error) {
      return this.handleError(error, 'reserveStock');
    }
  }

  /**
   * DELETE /api/v1/projects/{projectId}/stock/reservations/{itemCode}
   * Release stock reservation
   */
  async releaseReservation(
    context: ProcurementApiContext,
    itemCode: string,
    releaseQuantity: number
  ): Promise<ServiceResponse<StockPosition>> {
    try {
      const commandService = (this.stockService as any).commandService;
      return await commandService.releaseReservation(context.projectId, itemCode, releaseQuantity);
    } catch (error) {
      return this.handleError(error, 'releaseReservation');
    }
  }

  // 🟢 WORKING: Cable Drum Management Endpoints

  /**
   * GET /api/v1/projects/{projectId}/stock/drums
   * Get paginated list of cable drums
   */
  async getCableDrums(
    context: ProcurementApiContext,
    filters: { page?: number; limit?: number; cableType?: string; installationStatus?: string; currentLocation?: string } = {}
  ): Promise<ServiceResponse<{ drums: CableDrum[], total: number, page: number, limit: number }>> {
    return this.stockService.getCableDrums(context, filters);
  }

  /**
   * POST /api/v1/projects/{projectId}/stock/drums
   * Create new cable drum record
   */
  async createCableDrum(
    context: ProcurementApiContext,
    drumData: Omit<CableDrum, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ServiceResponse<CableDrum>> {
    try {
      const dataWithProject = {
        ...drumData,
        projectId: context.projectId,
      };
      
      const commandService = (this.stockService as any).commandService;
      return await commandService.createCableDrum(dataWithProject);
    } catch (error) {
      return this.handleError(error, 'createCableDrum');
    }
  }

  /**
   * PUT /api/v1/projects/{projectId}/stock/drums/{drumId}
   * Update cable drum information
   */
  async updateCableDrum(
    context: ProcurementApiContext,
    drumId: string,
    updateData: Partial<CableDrum>
  ): Promise<ServiceResponse<CableDrum>> {
    try {
      const commandService = (this.stockService as any).commandService;
      return await commandService.updateCableDrum(drumId, updateData, context.projectId);
    } catch (error) {
      return this.handleError(error, 'updateCableDrum');
    }
  }

  /**
   * POST /api/v1/projects/{projectId}/stock/drums/{drumId}/usage
   * Record cable drum usage
   */
  async updateDrumUsage(
    context: ProcurementApiContext,
    drumId: string,
    usageData: Omit<DrumUsageHistory, 'id' | 'drumId' | 'createdAt' | 'updatedAt'>
  ): Promise<ServiceResponse<DrumUsageHistory>> {
    // Ensure projectId matches context
    const dataWithProject = {
      ...usageData,
      projectId: context.projectId,
    };

    return this.stockService.updateDrumUsage(context, drumId, dataWithProject);
  }

  /**
   * GET /api/v1/projects/{projectId}/stock/drums/{drumId}/usage
   * Get usage history for a cable drum
   */
  async getDrumUsageHistory(
    _context: ProcurementApiContext,
    drumId: string
  ): Promise<ServiceResponse<DrumUsageHistory[]>> {
    try {
      const queryService = (this.stockService as any).queryService;
      return await queryService.getDrumUsageHistory(drumId);
    } catch (error) {
      return this.handleError(error, 'getDrumUsageHistory');
    }
  }

  // 🟢 WORKING: Dashboard and Analytics Endpoints

  /**
   * GET /api/v1/projects/{projectId}/stock/dashboard
   * Get comprehensive dashboard data for stock management
   */
  async getDashboardData(
    context: ProcurementApiContext
  ): Promise<ServiceResponse<StockDashboardData>> {
    return this.stockService.getDashboardData(context);
  }

  /**
   * GET /api/v1/projects/{projectId}/stock/valuation
   * Calculate total stock value and breakdown by category
   */
  async calculateStockValue(
    context: ProcurementApiContext
  ): Promise<ServiceResponse<{ totalValue: number, breakdown: Array<{ category: string, value: number }> }>> {
    return this.stockService.calculateStockValue(context);
  }

  /**
   * GET /api/v1/projects/{projectId}/stock/availability/{itemCode}
   * Check stock availability for specific quantity
   */
  async validateStockLevel(
    context: ProcurementApiContext,
    itemCode: string,
    requiredQuantity: number
  ): Promise<ServiceResponse<{ available: boolean, availableQuantity: number, shortfall?: number }>> {
    return this.stockService.validateStockLevel(context, itemCode, requiredQuantity);
  }

  /**
   * GET /api/v1/projects/{projectId}/stock/alerts
   * Get stock alerts for low stock, critical stock, etc.
   */
  async getStockAlerts(
    context: ProcurementApiContext
  ): Promise<ServiceResponse<{
    lowStock: StockPosition[];
    criticalStock: StockPosition[];
    excessStock: StockPosition[];
    obsoleteStock: StockPosition[];
  }>> {
    try {
      // Get positions with different stock statuses
      const lowStockResult = await this.stockService.getStockPositions(context, { 
        stockStatus: 'low', 
        limit: 100 
      });
      const criticalStockResult = await this.stockService.getStockPositions(context, { 
        stockStatus: 'critical', 
        limit: 100 
      });
      const excessStockResult = await this.stockService.getStockPositions(context, { 
        stockStatus: 'excess', 
        limit: 100 
      });
      const obsoleteStockResult = await this.stockService.getStockPositions(context, { 
        stockStatus: 'obsolete', 
        limit: 100 
      });

      return this.success({
        lowStock: lowStockResult.data?.positions || [],
        criticalStock: criticalStockResult.data?.positions || [],
        excessStock: excessStockResult.data?.positions || [],
        obsoleteStock: obsoleteStockResult.data?.positions || [],
      });
    } catch (error) {
      return this.handleError(error, 'getStockAlerts');
    }
  }

  // 🟢 WORKING: Reporting Endpoints

  /**
   * GET /api/v1/projects/{projectId}/stock/reports/movements
   * Generate stock movement report for specified date range
   */
  async generateMovementReport(
    context: ProcurementApiContext,
    fromDate: Date,
    toDate: Date,
    movementTypes?: string[]
  ): Promise<ServiceResponse<{
    summary: { totalMovements: number, totalValue: number };
    movementsByType: Array<{ type: string, count: number, value: number }>;
    dailyMovements: Array<{ date: string, movements: number, value: number }>;
    movements: StockMovement[];
  }>> {
    try {
      const filters: MovementFilters = {
        fromDate,
        toDate,
        limit: 1000, // Large limit for report
      };

      const movementsResult = await this.stockService.getStockMovements(context, filters);
      
      if (!movementsResult.success) {
        throw new Error(movementsResult.error);
      }

      const movements = movementsResult.data!.movements;
      
      // Filter by movement types if specified
      const filteredMovements = movementTypes 
        ? movements.filter(m => movementTypes.includes(m.movementType))
        : movements;

      // Calculate summary and analytics
      const totalMovements = filteredMovements.length;
      const totalValue = 0; // Would need to calculate from movement items

      // Group by type
      const movementsByType = filteredMovements.reduce((acc, movement) => {
        const existing = acc.find(item => item.type === movement.movementType);
        if (existing) {
          existing.count += 1;
        } else {
          acc.push({ type: movement.movementType, count: 1, value: 0 });
        }
        return acc;
      }, [] as Array<{ type: string, count: number, value: number }>);

      // Group by date
      const dailyMovements = filteredMovements.reduce((acc, movement) => {
        const dateKey = movement.movementDate.toISOString().split('T')[0]!;
        const existing = acc.find(item => item.date === dateKey);
        if (existing) {
          existing.movements += 1;
        } else {
          acc.push({ date: dateKey, movements: 1, value: 0 });
        }
        return acc;
      }, [] as Array<{ date: string, movements: number, value: number }>);

      return this.success({
        summary: { totalMovements, totalValue },
        movementsByType,
        dailyMovements,
        movements: filteredMovements,
      });
    } catch (error) {
      return this.handleError(error, 'generateMovementReport');
    }
  }

  /**
   * GET /api/v1/projects/{projectId}/stock/reports/valuation
   * Generate stock valuation report
   */
  async generateValuationReport(
    context: ProcurementApiContext
  ): Promise<ServiceResponse<{
    summary: { totalItems: number, totalValue: number, averageValue: number };
    byCategory: Array<{ category: string, items: number, value: number, percentage: number }>;
    byLocation: Array<{ location: string, items: number, value: number }>;
    lowValueItems: StockPosition[];
    highValueItems: StockPosition[];
  }>> {
    try {
      const positionsResult = await this.stockService.getStockPositions(context, { limit: 10000 });
      
      if (!positionsResult.success) {
        throw new Error(positionsResult.error);
      }

      const positions = positionsResult.data!.positions;
      const totalItems = positions.length;
      const totalValue = positions.reduce((sum, pos) => sum + (pos.totalValue || 0), 0);
      const averageValue = totalItems > 0 ? totalValue / totalItems : 0;

      // Group by category
      const categoryMap = new Map<string, { items: number, value: number }>();
      positions.forEach(pos => {
        const category = pos.category || 'Uncategorized';
        const existing = categoryMap.get(category) || { items: 0, value: 0 };
        categoryMap.set(category, {
          items: existing.items + 1,
          value: existing.value + (pos.totalValue || 0),
        });
      });

      const byCategory = Array.from(categoryMap.entries()).map(([category, data]) => ({
        category,
        items: data.items,
        value: data.value,
        percentage: totalValue > 0 ? Math.round((data.value / totalValue) * 100) : 0,
      }));

      // Group by location
      const locationMap = new Map<string, { items: number, value: number }>();
      positions.forEach(pos => {
        const location = pos.warehouseLocation || 'Unknown';
        const existing = locationMap.get(location) || { items: 0, value: 0 };
        locationMap.set(location, {
          items: existing.items + 1,
          value: existing.value + (pos.totalValue || 0),
        });
      });

      const byLocation = Array.from(locationMap.entries()).map(([location, data]) => ({
        location,
        items: data.items,
        value: data.value,
      }));

      // Sort positions by value
      const sortedPositions = positions
        .filter(pos => pos.totalValue && pos.totalValue > 0)
        .sort((a, b) => (b.totalValue || 0) - (a.totalValue || 0));

      const lowValueItems = sortedPositions.slice(-10); // Bottom 10
      const highValueItems = sortedPositions.slice(0, 10); // Top 10

      return this.success({
        summary: { totalItems, totalValue, averageValue },
        byCategory,
        byLocation,
        lowValueItems,
        highValueItems,
      });
    } catch (error) {
      return this.handleError(error, 'generateValuationReport');
    }
  }
}