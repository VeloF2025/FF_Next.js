/**
 * StockMovementService - Movement processing for stock management
 * Handles GRN, Issue, Transfer, Return, and other movement types
 */

import { BaseService, type ServiceResponse } from '../../../core/BaseService';
import { db } from '@/lib/neon/connection';
import { 
  stockPositions, 
  stockMovements, 
  stockMovementItems, 
  cableDrums, 
  drumUsageHistory 
// @ts-ignore
} from '@/lib/neon/schema/procurement/stock.schema';
// @ts-ignore
import { eq, and, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type {
  StockMovement,
  StockMovementItem,
  DrumUsageHistory,
  MovementTypeType
} from '@/types/procurement/stock';
import type { BulkMovementRequest } from '../StockService';
import { 
  StockError,
  InsufficientStockError,
  StockMovementError,
  StockTransferError 
} from '../../errors/stock';

export interface GRNData {
  referenceNumber: string;
  poNumber: string;
  supplierName: string;
  receivedBy: string;
  receivedDate: Date;
  items: Array<{
    itemCode: string;
    itemName: string;
    plannedQuantity: number;
    receivedQuantity: number;
    unitCost: number;
    lotNumbers?: string[];
    serialNumbers?: string[];
    qualityCheckRequired?: boolean;
    qualityNotes?: string;
  }>;
}

export interface IssueData {
  referenceNumber: string;
  workOrderNumber: string;
  issuedTo: string;
  issuedBy: string;
  issueDate: Date;
  purpose: string;
  items: Array<{
    itemCode: string;
    requestedQuantity: number;
    issuedQuantity: number;
    unitCost?: number;
    lotNumbers?: string[];
    serialNumbers?: string[];
    notes?: string;
  }>;
}

export interface TransferData {
  referenceNumber: string;
  fromProjectId: string;
  toProjectId: string;
  fromLocation: string;
  toLocation: string;
  transferredBy: string;
  transferDate: Date;
  reason: string;
  items: Array<{
    itemCode: string;
    transferQuantity: number;
    unitCost?: number;
    notes?: string;
  }>;
}

export interface ReturnData {
  referenceNumber: string;
  originalIssueNumber?: string;
  returnedBy: string;
  returnedTo: string;
  returnDate: Date;
  returnReason: string;
  items: Array<{
    itemCode: string;
    returnQuantity: number;
    condition: 'good' | 'damaged' | 'expired';
    notes?: string;
  }>;
}

export class StockMovementService extends BaseService {
  constructor() {
    super('StockMovementService', {
      timeout: 45000,
      retries: 1,
      cache: false,
    });
  }

  /**
   * Get health status of movement service
   */
  async getHealthStatus(): Promise<ServiceResponse<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details?: Record<string, unknown>;
  }>> {
    try {
      // Test transaction capabilities
      await db.transaction(async (tx: any) => {
        await tx.select().from(stockMovements).limit(1);
      });
      
      return this.success({
        status: 'healthy',
        details: {
          transactionSupport: 'enabled',
          movementProcessing: 'operational',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      return this.success({
        status: 'unhealthy',
        details: {
          transactionSupport: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  // 🟢 WORKING: Movement Creation
  async createMovement(
    movementData: Omit<StockMovement, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ServiceResponse<StockMovement>> {
    try {
      // Validate required fields
      if (!movementData.projectId || !movementData.movementType || !movementData.referenceNumber) {
        throw new StockMovementError(
          'Missing required fields: projectId, movementType, referenceNumber',
          'adjustment',
          movementData.referenceNumber || '',
          0
        );
      }

      // Check for duplicate reference number in project
      const [existingMovement] = await db
        .select()
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.projectId, movementData.projectId),
            eq(stockMovements.referenceNumber, movementData.referenceNumber)
          )
        )
        .limit(1);

      if (existingMovement) {
        throw new StockMovementError(
          `Movement with reference number ${movementData.referenceNumber} already exists`,
          'adjustment',
          movementData.referenceNumber,
          0
        );
      }

      // Create movement record
      const newMovement = {
        id: uuidv4(),
        ...movementData,
        status: movementData.status || 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.insert(stockMovements).values(newMovement);

      return this.success(this.mapStockMovement(newMovement));
    } catch (error) {
      if (error instanceof StockMovementError) {
        throw error;
      }
      return this.handleError(error, 'createMovement');
    }
  }

  // 🟢 WORKING: Goods Receipt Note (GRN) Processing
  async processGRN(
    projectId: string,
    grnData: GRNData
  ): Promise<ServiceResponse<{ movement: StockMovement, items: StockMovementItem[] }>> {
    try {
      return await db.transaction(async (tx: any) => {
        // Create GRN movement
        const movementId = uuidv4();
        const movementRecord = {
          id: movementId,
          projectId: projectId,
          movementType: 'GRN' as MovementTypeType,
          referenceNumber: grnData.referenceNumber,
          referenceType: 'PO',
          referenceId: grnData.poNumber,
          fromLocation: grnData.supplierName,
          toLocation: 'WAREHOUSE',
          fromProjectId: null,
          toProjectId: null,
          status: 'completed',
          movementDate: grnData.receivedDate,
          confirmedAt: grnData.receivedDate,
          requestedBy: grnData.receivedBy,
          authorizedBy: grnData.receivedBy,
          processedBy: grnData.receivedBy,
          notes: `GRN from supplier: ${grnData.supplierName}`,
          reason: 'Goods Receipt',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await tx.insert(stockMovements).values(movementRecord);

        const processedItems: StockMovementItem[] = [];

        // Process each item
        for (const item of grnData.items) {
          const itemId = uuidv4();
          
          // Create movement item record
          const movementItem = {
            id: itemId,
            stockMovementId: movementId,
            stockPositionId: '', // Will be set after creating/updating position
            projectId: projectId,
            itemCode: item.itemCode,
            description: item.itemName,
            plannedQuantity: item.plannedQuantity.toString(),
            actualQuantity: item.receivedQuantity.toString(),
            uom: 'EA', // Default UOM - should be passed in real implementation
            unitCost: item.unitCost.toString(),
            totalCost: (item.receivedQuantity * item.unitCost).toString(),
            lotNumbers: item.lotNumbers || null,
            serialNumbers: item.serialNumbers || null,
            expiryDate: null,
            qualityCheckRequired: item.qualityCheckRequired || false,
            qualityCheckStatus: item.qualityCheckRequired ? 'pending' : 'passed',
            qualityCheckNotes: item.qualityNotes,
            itemStatus: 'completed',
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          // Check if stock position exists
          const [existingPosition] = await tx
            .select()
            .from(stockPositions)
            .where(
              and(
                eq(stockPositions.projectId, projectId),
                eq(stockPositions.itemCode, item.itemCode)
              )
            )
            .limit(1);

          let positionId: string;

          if (existingPosition) {
            // Update existing position
            positionId = existingPosition.id;
            const currentOnHand = Number(existingPosition.onHandQuantity);
            const currentReserved = Number(existingPosition.reservedQuantity);
            const currentCost = Number(existingPosition.averageUnitCost) || 0;
            
            const newOnHand = currentOnHand + item.receivedQuantity;
            const newAvailable = newOnHand - currentReserved;
            
            // Calculate weighted average cost
            const currentValue = currentOnHand * currentCost;
            const newItemValue = item.receivedQuantity * item.unitCost;
            const newAverageCost = newOnHand > 0 ? (currentValue + newItemValue) / newOnHand : item.unitCost;
            const newTotalValue = newOnHand * newAverageCost;

            await tx
              .update(stockPositions)
              .set({
                onHandQuantity: newOnHand.toString(),
                availableQuantity: newAvailable.toString(),
                averageUnitCost: newAverageCost.toString(),
                totalValue: newTotalValue.toString(),
                lastMovementDate: grnData.receivedDate,
                updatedAt: new Date(),
              })
              .where(eq(stockPositions.id, existingPosition.id));
          } else {
            // Create new position
            positionId = uuidv4();
            const newPosition = {
              id: positionId,
              projectId: projectId,
              itemCode: item.itemCode,
              itemName: item.itemName,
              description: item.itemName,
              uom: 'EA', // Default UOM
              onHandQuantity: item.receivedQuantity.toString(),
              reservedQuantity: '0',
              availableQuantity: item.receivedQuantity.toString(),
              inTransitQuantity: '0',
              averageUnitCost: item.unitCost.toString(),
              totalValue: (item.receivedQuantity * item.unitCost).toString(),
              warehouseLocation: 'WAREHOUSE',
              lastMovementDate: grnData.receivedDate,
              isActive: true,
              stockStatus: 'normal',
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            await tx.insert(stockPositions).values(newPosition);
          }

          // Update movement item with position ID
          movementItem.stockPositionId = positionId;
          await tx.insert(stockMovementItems).values(movementItem);

          processedItems.push(this.mapStockMovementItem(movementItem));
        }

        return this.success({
          movement: this.mapStockMovement(movementRecord),
          items: processedItems,
        });
      });
    } catch (error) {
      if (error instanceof StockMovementError) {
        throw error;
      }
      return this.handleError(error, 'processGRN');
    }
  }

  // 🟢 WORKING: Stock Issue Processing
  async processIssue(
    projectId: string,
    issueData: IssueData
  ): Promise<ServiceResponse<{ movement: StockMovement, items: StockMovementItem[] }>> {
    try {
      return await db.transaction(async (tx: any) => {
        // Validate stock availability for all items first
        for (const item of issueData.items) {
          const [position] = await tx
            .select()
            .from(stockPositions)
            .where(
              and(
                eq(stockPositions.projectId, projectId),
                eq(stockPositions.itemCode, item.itemCode),
                eq(stockPositions.isActive, true)
              )
            )
            .limit(1);

          if (!position) {
            throw new InsufficientStockError(
              item.itemCode,
              item.issuedQuantity,
              0
            );
          }

          const availableQuantity = Number(position.availableQuantity);
          if (availableQuantity < item.issuedQuantity) {
            throw new InsufficientStockError(
              item.itemCode,
              item.issuedQuantity,
              availableQuantity
            );
          }
        }

        // Create issue movement
        const movementId = uuidv4();
        const movementRecord = {
          id: movementId,
          projectId: projectId,
          movementType: 'ISSUE' as MovementTypeType,
          referenceNumber: issueData.referenceNumber,
          referenceType: 'WORK_ORDER',
          referenceId: issueData.workOrderNumber,
          fromLocation: 'WAREHOUSE',
          toLocation: issueData.issuedTo,
          fromProjectId: null,
          toProjectId: null,
          status: 'completed',
          movementDate: issueData.issueDate,
          confirmedAt: issueData.issueDate,
          requestedBy: issueData.issuedBy,
          authorizedBy: issueData.issuedBy,
          processedBy: issueData.issuedBy,
          notes: null,
          reason: issueData.purpose,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await tx.insert(stockMovements).values(movementRecord);

        const processedItems: StockMovementItem[] = [];

        // Process each item
        for (const item of issueData.items) {
          const itemId = uuidv4();
          
          // Get current position
          const [position] = await tx
            .select()
            .from(stockPositions)
            .where(
              and(
                eq(stockPositions.projectId, projectId),
                eq(stockPositions.itemCode, item.itemCode)
              )
            )
            .limit(1);

          // Calculate new quantities
          const currentOnHand = Number(position!.onHandQuantity);
          const currentReserved = Number(position!.reservedQuantity);
          const newOnHand = currentOnHand - item.issuedQuantity;
          const newAvailable = newOnHand - currentReserved;

          // Update position
          await tx
            .update(stockPositions)
            .set({
              onHandQuantity: newOnHand.toString(),
              availableQuantity: newAvailable.toString(),
              totalValue: sql`${stockPositions.averageUnitCost} * ${newOnHand}`,
              lastMovementDate: issueData.issueDate,
              updatedAt: new Date(),
            })
            .where(eq(stockPositions.id, position!.id));

          // Create movement item record
          const unitCost = item.unitCost || Number(position!.averageUnitCost) || 0;
          const movementItem = {
            id: itemId,
            stockMovementId: movementId,
            stockPositionId: position!.id,
            projectId: projectId,
            itemCode: item.itemCode,
            description: position!.itemName,
            plannedQuantity: item.requestedQuantity.toString(),
            actualQuantity: item.issuedQuantity.toString(),
            uom: position!.uom,
            unitCost: unitCost.toString(),
            totalCost: (item.issuedQuantity * unitCost).toString(),
            lotNumbers: item.lotNumbers || null,
            serialNumbers: item.serialNumbers || null,
            expiryDate: null,
            qualityCheckRequired: false,
            qualityCheckStatus: 'passed',
            qualityCheckNotes: item.notes,
            itemStatus: 'completed',
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await tx.insert(stockMovementItems).values(movementItem);
          processedItems.push(this.mapStockMovementItem(movementItem));
        }

        return this.success({
          movement: this.mapStockMovement(movementRecord),
          items: processedItems,
        });
      });
    } catch (error) {
      if (error instanceof StockMovementError || error instanceof InsufficientStockError) {
        throw error;
      }
      return this.handleError(error, 'processIssue');
    }
  }

  // 🟢 WORKING: Stock Transfer Processing
  async processTransfer(
    transferData: TransferData
  ): Promise<ServiceResponse<{ movement: StockMovement, items: StockMovementItem[] }>> {
    try {
      return await db.transaction(async (tx: any) => {
        // Validate stock availability in source project
        for (const item of transferData.items) {
          const [sourcePosition] = await tx
            .select()
            .from(stockPositions)
            .where(
              and(
                eq(stockPositions.projectId, transferData.fromProjectId),
                eq(stockPositions.itemCode, item.itemCode),
                eq(stockPositions.isActive, true)
              )
            )
            .limit(1);

          if (!sourcePosition) {
            throw new StockTransferError(
              item.itemCode,
              transferData.fromProjectId,
              transferData.toProjectId,
              item.transferQuantity,
              `Item ${item.itemCode} not found in source project`
            );
          }

          const availableQuantity = Number(sourcePosition.availableQuantity);
          if (availableQuantity < item.transferQuantity) {
            throw new InsufficientStockError(
              item.itemCode,
              item.transferQuantity,
              availableQuantity
            );
          }
        }

        // Create transfer movement
        const movementId = uuidv4();
        const movementRecord = {
          id: movementId,
          projectId: transferData.fromProjectId, // Movement recorded in source project
          movementType: 'TRANSFER' as MovementTypeType,
          referenceNumber: transferData.referenceNumber,
          referenceType: 'TRANSFER',
          referenceId: null,
          fromLocation: transferData.fromLocation,
          toLocation: transferData.toLocation,
          fromProjectId: transferData.fromProjectId,
          toProjectId: transferData.toProjectId,
          status: 'completed',
          movementDate: transferData.transferDate,
          confirmedAt: transferData.transferDate,
          requestedBy: transferData.transferredBy,
          authorizedBy: transferData.transferredBy,
          processedBy: transferData.transferredBy,
          notes: null,
          reason: transferData.reason,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await tx.insert(stockMovements).values(movementRecord);

        const processedItems: StockMovementItem[] = [];

        // Process each item
        for (const item of transferData.items) {
          const itemId = uuidv4();

          // Update source project stock
          const [sourcePosition] = await tx
            .select()
            .from(stockPositions)
            .where(
              and(
                eq(stockPositions.projectId, transferData.fromProjectId),
                eq(stockPositions.itemCode, item.itemCode)
              )
            )
            .limit(1);

          const sourceOnHand = Number(sourcePosition!.onHandQuantity);
          const sourceReserved = Number(sourcePosition!.reservedQuantity);
          const newSourceOnHand = sourceOnHand - item.transferQuantity;
          const newSourceAvailable = newSourceOnHand - sourceReserved;

          await tx
            .update(stockPositions)
            .set({
              onHandQuantity: newSourceOnHand.toString(),
              availableQuantity: newSourceAvailable.toString(),
              totalValue: sql`${stockPositions.averageUnitCost} * ${newSourceOnHand}`,
              lastMovementDate: transferData.transferDate,
              updatedAt: new Date(),
            })
            .where(eq(stockPositions.id, sourcePosition!.id));

          // Update or create destination project stock
          const [destPosition] = await tx
            .select()
            .from(stockPositions)
            .where(
              and(
                eq(stockPositions.projectId, transferData.toProjectId),
                eq(stockPositions.itemCode, item.itemCode)
              )
            )
            .limit(1);

          const unitCost = item.unitCost || Number(sourcePosition!.averageUnitCost) || 0;

          if (destPosition) {
            // Update existing destination position
            const destOnHand = Number(destPosition.onHandQuantity);
            const destReserved = Number(destPosition.reservedQuantity);
            const destCost = Number(destPosition.averageUnitCost) || 0;
            
            const newDestOnHand = destOnHand + item.transferQuantity;
            const newDestAvailable = newDestOnHand - destReserved;
            
            // Calculate weighted average cost
            const currentValue = destOnHand * destCost;
            const transferValue = item.transferQuantity * unitCost;
            const newAverageCost = newDestOnHand > 0 ? (currentValue + transferValue) / newDestOnHand : unitCost;
            const newTotalValue = newDestOnHand * newAverageCost;

            await tx
              .update(stockPositions)
              .set({
                onHandQuantity: newDestOnHand.toString(),
                availableQuantity: newDestAvailable.toString(),
                averageUnitCost: newAverageCost.toString(),
                totalValue: newTotalValue.toString(),
                lastMovementDate: transferData.transferDate,
                updatedAt: new Date(),
              })
              .where(eq(stockPositions.id, destPosition.id));
          } else {
            // Create new destination position
            const newDestPosition = {
              id: uuidv4(),
              projectId: transferData.toProjectId,
              itemCode: item.itemCode,
              itemName: sourcePosition!.itemName,
              description: sourcePosition!.description,
              category: sourcePosition!.category,
              uom: sourcePosition!.uom,
              onHandQuantity: item.transferQuantity.toString(),
              reservedQuantity: '0',
              availableQuantity: item.transferQuantity.toString(),
              inTransitQuantity: '0',
              averageUnitCost: unitCost.toString(),
              totalValue: (item.transferQuantity * unitCost).toString(),
              warehouseLocation: transferData.toLocation,
              binLocation: sourcePosition!.binLocation,
              reorderLevel: sourcePosition!.reorderLevel,
              maxStockLevel: sourcePosition!.maxStockLevel,
              economicOrderQuantity: sourcePosition!.economicOrderQuantity,
              lastMovementDate: transferData.transferDate,
              lastCountDate: null,
              nextCountDue: null,
              isActive: true,
              stockStatus: 'normal',
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            await tx.insert(stockPositions).values(newDestPosition);
          }

          // Create movement item record
          const movementItem = {
            id: itemId,
            stockMovementId: movementId,
            stockPositionId: sourcePosition!.id,
            projectId: transferData.fromProjectId,
            itemCode: item.itemCode,
            description: sourcePosition!.itemName,
            plannedQuantity: item.transferQuantity.toString(),
            actualQuantity: item.transferQuantity.toString(),
            uom: sourcePosition!.uom,
            unitCost: unitCost.toString(),
            totalCost: (item.transferQuantity * unitCost).toString(),
            lotNumbers: null,
            serialNumbers: null,
            expiryDate: null,
            qualityCheckRequired: false,
            qualityCheckStatus: 'passed',
            qualityCheckNotes: item.notes,
            itemStatus: 'completed',
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await tx.insert(stockMovementItems).values(movementItem);
          processedItems.push(this.mapStockMovementItem(movementItem));
        }

        return this.success({
          movement: this.mapStockMovement(movementRecord),
          items: processedItems,
        });
      });
    } catch (error) {
      if (error instanceof StockTransferError || error instanceof InsufficientStockError) {
        throw error;
      }
      return this.handleError(error, 'processTransfer');
    }
  }

  // 🟢 WORKING: Bulk Movement Processing
  async processBulkMovement(
    bulkData: BulkMovementRequest,
    projectId: string,
    userId: string
  ): Promise<ServiceResponse<{ movement: StockMovement, items: StockMovementItem[] }>> {
    try {
      // Route to appropriate movement processor based on type
      switch (bulkData.movementType) {
        case 'GRN':
          const grnData: GRNData = {
            referenceNumber: bulkData.referenceNumber,
            poNumber: bulkData.referenceId || 'N/A',
            supplierName: bulkData.fromLocation || 'Unknown Supplier',
            receivedBy: userId,
            receivedDate: new Date(),
            items: bulkData.items.map(item => ({
              itemCode: item.itemCode,
              itemName: item.itemCode, // Should be enriched from catalog
              plannedQuantity: item.plannedQuantity,
              receivedQuantity: item.plannedQuantity,
              unitCost: item.unitCost || 0,
              ...(item.lotNumbers && { lotNumbers: item.lotNumbers }),
              ...(item.serialNumbers && { serialNumbers: item.serialNumbers }),
            })),
          };
          return this.processGRN(projectId, grnData);

        case 'ISSUE':
          const issueData: IssueData = {
            referenceNumber: bulkData.referenceNumber,
            workOrderNumber: bulkData.referenceId || 'N/A',
            issuedTo: bulkData.toLocation || 'Field Operations',
            issuedBy: userId,
            issueDate: new Date(),
            purpose: bulkData.reason || 'Project Issue',
            items: bulkData.items.map(item => ({
              itemCode: item.itemCode,
              requestedQuantity: item.plannedQuantity,
              issuedQuantity: item.plannedQuantity,
              ...(item.unitCost !== undefined && { unitCost: item.unitCost }),
              ...(item.lotNumbers && { lotNumbers: item.lotNumbers }),
              ...(item.serialNumbers && { serialNumbers: item.serialNumbers }),
            })),
          };
          return this.processIssue(projectId, issueData);

        case 'TRANSFER':
          if (!bulkData.fromProjectId || !bulkData.toProjectId) {
            throw new StockMovementError('Transfer requires fromProjectId and toProjectId', 'transfer', '', 0);
          }
          
          const transferData: TransferData = {
            referenceNumber: bulkData.referenceNumber,
            fromProjectId: bulkData.fromProjectId,
            toProjectId: bulkData.toProjectId,
            fromLocation: bulkData.fromLocation || 'Unknown',
            toLocation: bulkData.toLocation || 'Unknown',
            transferredBy: userId,
            transferDate: new Date(),
            reason: bulkData.reason || 'Project Transfer',
            items: bulkData.items.map(item => ({
              itemCode: item.itemCode,
              transferQuantity: item.plannedQuantity,
              ...(item.unitCost !== undefined && { unitCost: item.unitCost }),
            })),
          };
          return this.processTransfer(transferData);

        default:
          throw new StockMovementError(
            `Bulk processing not supported for movement type: ${bulkData.movementType}`,
            'adjustment', // Map to the closest valid MovementType
            '',
            0
          );
      }
    } catch (error) {
      if (error instanceof StockMovementError) {
        throw error;
      }
      return this.handleError(error, 'processBulkMovement');
    }
  }

  // 🟢 WORKING: Cable Drum Usage Management
  async updateDrumUsage(
    drumId: string,
    usageData: Omit<DrumUsageHistory, 'id' | 'drumId' | 'createdAt' | 'updatedAt'>
  ): Promise<ServiceResponse<DrumUsageHistory>> {
    try {
      return await db.transaction(async (tx: any) => {
        // Get current drum information
        const [drum] = await tx
          .select()
          .from(cableDrums)
          .where(eq(cableDrums.id, drumId))
          .limit(1);

        if (!drum) {
          throw new StockError('Cable drum not found', 'NOT_FOUND');
        }

        // Validate usage data
        if (usageData.currentReading < usageData.previousReading) {
          throw new StockError(
            'Current reading cannot be less than previous reading',
            'VALIDATION_FAILED'
          );
        }

        const calculatedUsedLength = usageData.currentReading - usageData.previousReading;
        if (Math.abs(calculatedUsedLength - usageData.usedLength) > 0.01) {
          throw new StockError(
            'Used length does not match reading difference',
            'VALIDATION_FAILED'
          );
        }

        const currentLength = Number(drum.currentLength);
        const newCurrentLength = currentLength - usageData.usedLength;
        const newUsedLength = Number(drum.usedLength) + usageData.usedLength;

        if (newCurrentLength < 0) {
          throw new StockError(
            'Cannot use more cable than available on drum',
            'VALIDATION_FAILED'
          );
        }

        // Create usage history record
        const usageRecord = {
          id: uuidv4(),
          drumId: drumId,
          projectId: usageData.projectId,
          usageDate: usageData.usageDate,
          previousReading: usageData.previousReading.toString(),
          currentReading: usageData.currentReading.toString(),
          usedLength: usageData.usedLength.toString(),
          poleNumber: usageData.poleNumber,
          sectionId: usageData.sectionId,
          workOrderId: usageData.workOrderId,
          technicianId: usageData.technicianId,
          installationType: usageData.installationType,
          startCoordinates: usageData.startCoordinates,
          endCoordinates: usageData.endCoordinates,
          installationNotes: usageData.installationNotes,
          qualityNotes: usageData.qualityNotes,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await tx.insert(drumUsageHistory).values(usageRecord);

        // Update drum with new readings and lengths
        await tx
          .update(cableDrums)
          .set({
            currentLength: newCurrentLength.toString(),
            usedLength: newUsedLength.toString(),
            lastMeterReading: usageData.currentReading.toString(),
            lastReadingDate: usageData.usageDate,
            lastUsedDate: usageData.usageDate,
            installationStatus: newCurrentLength <= 0 ? 'completed' : 'in_use',
            updatedAt: new Date(),
          })
          .where(eq(cableDrums.id, drumId));

        return this.success(this.mapDrumUsageHistory(usageRecord));
      });
    } catch (error) {
      if (error instanceof StockError) {
        throw error;
      }
      return this.handleError(error, 'updateDrumUsage');
    }
  }

  // 🔵 HELPER: Mapping Functions
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
    const mappedItem: any = {
      id: item.id,
      movementId: item.stockMovementId,
      stockPositionId: item.stockPositionId,
      projectId: item.projectId,
      itemCode: item.itemCode,
      itemName: item.description || item.itemCode,
      description: item.description,
      uom: item.uom,
      plannedQuantity: Number(item.plannedQuantity),
      ...(item.actualQuantity !== undefined && { actualQuantity: Number(item.actualQuantity) }),
      ...(item.actualQuantity !== undefined && { receivedQuantity: Number(item.actualQuantity) }),
      ...(item.unitCost !== undefined && { unitCost: Number(item.unitCost) }),
      ...(item.totalCost !== undefined && { totalCost: Number(item.totalCost) }),
      lotNumbers: item.lotNumbers || [],
      serialNumbers: item.serialNumbers || [],
      itemStatus: item.itemStatus,
      qualityCheckRequired: item.qualityCheckRequired,
      qualityCheckStatus: item.qualityCheckStatus,
      qualityNotes: item.qualityCheckNotes,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
    
    return mappedItem as StockMovementItem;
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
}

export default StockMovementService;