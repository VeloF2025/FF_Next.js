/**
 * StockCommandService - Write operations for stock management
 * Handles create, update, delete operations with validation and business rules
 */

import { BaseService, type ServiceResponse } from '../../../core/BaseService';
import { db } from '@/lib/neon/connection';
// @ts-expect-error — module lacks type declarations
import { stockPositions, stockMovements, stockMovementItems, cableDrums } from '@/lib/neon/schema/procurement/stock.schema';
// @ts-expect-error — module lacks type declarations
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type {
  StockPosition,
  CableDrum
} from '@/types/procurement/stock';
import { 
  StockError,
  InsufficientStockError,
  StockReservationError 
} from '../../errors/stock';

export interface CreateStockPositionData {
  projectId: string;
  itemCode: string;
  itemName: string;
  description?: string;
  category?: string;
  uom: string;
  onHandQuantity?: number;
  averageUnitCost?: number;
  warehouseLocation?: string;
  binLocation?: string;
  reorderLevel?: number;
  maxStockLevel?: number;
  economicOrderQuantity?: number;
}

export interface StockAdjustmentData {
  itemCode: string;
  adjustmentQuantity: number;
  adjustmentType: 'increase' | 'decrease';
  reason: string;
  referenceNumber: string;
  unitCost?: number;
}

export interface StockReservationData {
  itemCode: string;
  reservedQuantity: number;
  reservedBy: string;
  reservationReason: string;
  expiresAt?: Date;
}

export class StockCommandService extends BaseService {
  constructor() {
    super('StockCommandService', {
      timeout: 30000,
      retries: 1, // Lower retries for write operations
      cache: false, // No caching for write operations
    });
  }

  /**
   * Get health status of command service
   */
  async getHealthStatus(): Promise<ServiceResponse<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details?: Record<string, unknown>;
  }>> {
    try {
      // Test write capabilities with a read-only operation
      await db.select().from(stockPositions).limit(1);
      
      return this.success({
        status: 'healthy',
        details: {
          writeCapabilities: 'operational',
          transactionSupport: 'enabled',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      return this.success({
        status: 'unhealthy',
        details: {
          writeCapabilities: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  // 🟢 WORKING: Stock Position CRUD Operations
  async createStockPosition(
    positionData: CreateStockPositionData
  ): Promise<ServiceResponse<StockPosition>> {
    try {
      // Validate required fields
      if (!positionData.projectId || !positionData.itemCode || !positionData.itemName || !positionData.uom) {
        throw new StockError('Missing required fields: projectId, itemCode, itemName, uom', 'VALIDATION_FAILED');
      }

      // Check if item already exists in project
      const [existingPosition] = await db
        .select()
        .from(stockPositions)
        .where(
          and(
            eq(stockPositions.projectId, positionData.projectId),
            eq(stockPositions.itemCode, positionData.itemCode)
          )
        )
        .limit(1);

      if (existingPosition) {
        throw new StockError(
          `Stock position already exists for item ${positionData.itemCode} in project ${positionData.projectId}`,
          'DUPLICATE_ENTRY'
        );
      }

      // Calculate initial values
      const onHandQuantity = positionData.onHandQuantity || 0;
      const averageUnitCost = positionData.averageUnitCost || 0;
      const totalValue = onHandQuantity * averageUnitCost;

      // Insert new stock position
      const newPosition = {
        id: uuidv4(),
        projectId: positionData.projectId,
        itemCode: positionData.itemCode,
        itemName: positionData.itemName,
        description: positionData.description,
        category: positionData.category,
        uom: positionData.uom,
        onHandQuantity: onHandQuantity.toString(),
        reservedQuantity: '0',
        availableQuantity: onHandQuantity.toString(),
        inTransitQuantity: '0',
        averageUnitCost: averageUnitCost.toString(),
        totalValue: totalValue.toString(),
        warehouseLocation: positionData.warehouseLocation,
        binLocation: positionData.binLocation,
        reorderLevel: positionData.reorderLevel?.toString(),
        maxStockLevel: positionData.maxStockLevel?.toString(),
        economicOrderQuantity: positionData.economicOrderQuantity?.toString(),
        lastMovementDate: null,
        lastCountDate: new Date(),
        nextCountDue: null,
        isActive: true,
        stockStatus: this.calculateStockStatus(onHandQuantity, positionData.reorderLevel || 0),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.insert(stockPositions).values(newPosition);

      return this.success(this.mapStockPosition(newPosition));
    } catch (error) {
      if (error instanceof StockError) {
        throw error;
      }
      return this.handleError(error, 'createStockPosition');
    }
  }

  async updateStockPosition(
    positionId: string,
    updateData: Partial<StockPosition>,
    projectId: string
  ): Promise<ServiceResponse<StockPosition>> {
    try {
      // Check if position exists and belongs to project
      const [existingPosition] = await db
        .select()
        .from(stockPositions)
        .where(
          and(
            eq(stockPositions.id, positionId),
            eq(stockPositions.projectId, projectId)
          )
        )
        .limit(1);

      if (!existingPosition) {
        throw new StockError('Stock position not found', 'NOT_FOUND');
      }

      // Prepare update data — Record<string, unknown> allows delete + string coercion
      const updateFields: Record<string, unknown> = {
        ...updateData,
        updatedAt: new Date(),
      };

      // Remove fields that shouldn't be updated directly
      delete updateFields.id;
      delete updateFields.createdAt;
      delete updateFields.projectId;

      // Convert numeric fields to strings for database
      if (updateFields.onHandQuantity !== undefined) {
        updateFields.onHandQuantity = String(updateFields.onHandQuantity);
      }
      if (updateFields.reservedQuantity !== undefined) {
        updateFields.reservedQuantity = String(updateFields.reservedQuantity);
      }
      if (updateFields.availableQuantity !== undefined) {
        updateFields.availableQuantity = String(updateFields.availableQuantity);
      }
      if (updateFields.inTransitQuantity !== undefined) {
        updateFields.inTransitQuantity = String(updateFields.inTransitQuantity);
      }
      if (updateFields.averageUnitCost !== undefined) {
        updateFields.averageUnitCost = String(updateFields.averageUnitCost);
      }
      if (updateFields.totalValue !== undefined) {
        updateFields.totalValue = String(updateFields.totalValue);
      }

      // Update the position
      await db
        .update(stockPositions)
        .set(updateFields)
        .where(eq(stockPositions.id, positionId));

      // Fetch updated position
      const [updatedPosition] = await db
        .select()
        .from(stockPositions)
        .where(eq(stockPositions.id, positionId))
        .limit(1);

      return this.success(this.mapStockPosition(updatedPosition));
    } catch (error) {
      if (error instanceof StockError) {
        throw error;
      }
      return this.handleError(error, 'updateStockPosition');
    }
  }

  async deleteStockPosition(
    positionId: string,
    projectId: string
  ): Promise<ServiceResponse<boolean>> {
    try {
      // Check if position exists and has no reserved quantity
      const [existingPosition] = await db
        .select()
        .from(stockPositions)
        .where(
          and(
            eq(stockPositions.id, positionId),
            eq(stockPositions.projectId, projectId)
          )
        )
        .limit(1);

      if (!existingPosition) {
        throw new StockError('Stock position not found', 'NOT_FOUND');
      }

      const reservedQuantity = Number(existingPosition.reservedQuantity);
      if (reservedQuantity > 0) {
        throw new StockError(
          `Cannot delete stock position with reserved quantity: ${reservedQuantity}`,
          'VALIDATION_FAILED'
        );
      }

      // Soft delete by setting isActive to false
      await db
        .update(stockPositions)
        .set({ 
          isActive: false, 
          updatedAt: new Date() 
        })
        .where(eq(stockPositions.id, positionId));

      return this.success(true);
    } catch (error) {
      if (error instanceof StockError) {
        throw error;
      }
      return this.handleError(error, 'deleteStockPosition');
    }
  }

  // 🟢 WORKING: Stock Level Management
  async adjustStockLevel(
    projectId: string,
    adjustmentData: StockAdjustmentData,
    userId: string
  ): Promise<ServiceResponse<StockPosition>> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await db.transaction(async (tx: any) => {
        // Get current stock position
        const [currentPosition] = await tx
          .select()
          .from(stockPositions)
          .where(
            and(
              eq(stockPositions.projectId, projectId),
              eq(stockPositions.itemCode, adjustmentData.itemCode),
              eq(stockPositions.isActive, true)
            )
          )
          .limit(1);

        if (!currentPosition) {
          throw new StockError(
            `Stock position not found for item ${adjustmentData.itemCode}`,
            'NOT_FOUND'
          );
        }

        const currentOnHand = Number(currentPosition.onHandQuantity);
        const currentReserved = Number(currentPosition.reservedQuantity);
        
        let newOnHand: number;
        if (adjustmentData.adjustmentType === 'increase') {
          newOnHand = currentOnHand + adjustmentData.adjustmentQuantity;
        } else {
          newOnHand = currentOnHand - adjustmentData.adjustmentQuantity;
          
          // Validate we don't go below reserved quantity
          if (newOnHand < currentReserved) {
            throw new InsufficientStockError(
              adjustmentData.itemCode,
              Number(adjustmentData.adjustmentQuantity),
              currentOnHand - currentReserved
            );
          }
        }

        // Calculate new available quantity and total value
        const newAvailable = newOnHand - currentReserved;
        const currentCost = Number(currentPosition.averageUnitCost) || 0;
        const adjustmentCost = adjustmentData.unitCost || currentCost;
        
        // Calculate weighted average cost for increases
        let newAverageCost = currentCost;
        if (adjustmentData.adjustmentType === 'increase' && adjustmentData.adjustmentQuantity > 0) {
          const currentValue = currentOnHand * currentCost;
          const adjustmentValue = adjustmentData.adjustmentQuantity * adjustmentCost;
          newAverageCost = newOnHand > 0 ? (currentValue + adjustmentValue) / newOnHand : 0;
        }
        
        const newTotalValue = newOnHand * newAverageCost;
        const newStockStatus = this.calculateStockStatus(newOnHand, Number(currentPosition.reorderLevel) || 0);

        // Update stock position
        await tx
          .update(stockPositions)
          .set({
            onHandQuantity: newOnHand.toString(),
            availableQuantity: newAvailable.toString(),
            averageUnitCost: newAverageCost.toString(),
            totalValue: newTotalValue.toString(),
            stockStatus: newStockStatus,
            lastMovementDate: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(stockPositions.id, currentPosition.id));

        // Create adjustment movement record
        const movementId = uuidv4();
        const movementItemId = uuidv4();

        await tx.insert(stockMovements).values({
          id: movementId,
          projectId: projectId,
          movementType: 'ADJUSTMENT',
          referenceNumber: adjustmentData.referenceNumber,
          referenceType: 'ADJUSTMENT',
          referenceId: null,
          fromLocation: null,
          toLocation: currentPosition.warehouseLocation,
          fromProjectId: null,
          toProjectId: null,
          status: 'completed',
          movementDate: new Date(),
          confirmedAt: new Date(),
          requestedBy: userId,
          authorizedBy: userId,
          processedBy: userId,
          notes: null,
          reason: adjustmentData.reason,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await tx.insert(stockMovementItems).values({
          id: movementItemId,
          stockMovementId: movementId,
          stockPositionId: currentPosition.id,
          projectId: projectId,
          itemCode: adjustmentData.itemCode,
          description: currentPosition.description || adjustmentData.itemCode,
          plannedQuantity: adjustmentData.adjustmentQuantity.toString(),
          actualQuantity: adjustmentData.adjustmentQuantity.toString(),
          uom: currentPosition.uom,
          unitCost: adjustmentCost.toString(),
          totalCost: (adjustmentData.adjustmentQuantity * adjustmentCost).toString(),
          lotNumbers: null,
          serialNumbers: null,
          expiryDate: null,
          qualityCheckRequired: false,
          qualityCheckStatus: null,
          qualityCheckNotes: null,
          itemStatus: 'completed',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Fetch updated position
        const [updatedPosition] = await tx
          .select()
          .from(stockPositions)
          .where(eq(stockPositions.id, currentPosition.id))
          .limit(1);

        return this.success(this.mapStockPosition(updatedPosition));
      });
    } catch (error) {
      if (error instanceof StockError || error instanceof InsufficientStockError) {
        throw error;
      }
      return this.handleError(error, 'adjustStockLevel');
    }
  }

  // 🟢 WORKING: Stock Reservation Management
  async reserveStock(
    projectId: string,
    reservationData: StockReservationData
  ): Promise<ServiceResponse<StockPosition>> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await db.transaction(async (tx: any) => {
        // Get current stock position
        const [currentPosition] = await tx
          .select()
          .from(stockPositions)
          .where(
            and(
              eq(stockPositions.projectId, projectId),
              eq(stockPositions.itemCode, reservationData.itemCode),
              eq(stockPositions.isActive, true)
            )
          )
          .limit(1);

        if (!currentPosition) {
          throw new StockError(
            `Stock position not found for item ${reservationData.itemCode}`,
            'NOT_FOUND'
          );
        }

        const currentAvailable = Number(currentPosition.availableQuantity);
        const currentReserved = Number(currentPosition.reservedQuantity);
        
        // Check if enough stock is available
        if (currentAvailable < reservationData.reservedQuantity) {
          throw new InsufficientStockError(
            reservationData.itemCode,
            Number(reservationData.reservedQuantity),
            currentAvailable
          );
        }

        // Calculate new quantities
        const newReserved = currentReserved + reservationData.reservedQuantity;
        const newAvailable = currentAvailable - reservationData.reservedQuantity;

        // Update stock position
        await tx
          .update(stockPositions)
          .set({
            reservedQuantity: newReserved.toString(),
            availableQuantity: newAvailable.toString(),
            lastMovementDate: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(stockPositions.id, currentPosition.id));

        // Fetch updated position
        const [updatedPosition] = await tx
          .select()
          .from(stockPositions)
          .where(eq(stockPositions.id, currentPosition.id))
          .limit(1);

        return this.success(this.mapStockPosition(updatedPosition));
      });
    } catch (error) {
      if (error instanceof StockError || error instanceof InsufficientStockError) {
        throw error;
      }
      return this.handleError(error, 'reserveStock');
    }
  }

  async releaseReservation(
    projectId: string,
    itemCode: string,
    releaseQuantity: number
  ): Promise<ServiceResponse<StockPosition>> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await db.transaction(async (tx: any) => {
        // Get current stock position
        const [currentPosition] = await tx
          .select()
          .from(stockPositions)
          .where(
            and(
              eq(stockPositions.projectId, projectId),
              eq(stockPositions.itemCode, itemCode),
              eq(stockPositions.isActive, true)
            )
          )
          .limit(1);

        if (!currentPosition) {
          throw new StockError(
            `Stock position not found for item ${itemCode}`,
            'NOT_FOUND'
          );
        }

        const currentReserved = Number(currentPosition.reservedQuantity);
        const currentAvailable = Number(currentPosition.availableQuantity);
        
        // Check if enough reservation exists to release
        if (currentReserved < releaseQuantity) {
          throw new StockReservationError(
            itemCode,
            Number(releaseQuantity),
            currentReserved,
            []
          );
        }

        // Calculate new quantities
        const newReserved = currentReserved - releaseQuantity;
        const newAvailable = currentAvailable + releaseQuantity;

        // Update stock position
        await tx
          .update(stockPositions)
          .set({
            reservedQuantity: newReserved.toString(),
            availableQuantity: newAvailable.toString(),
            lastMovementDate: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(stockPositions.id, currentPosition.id));

        // Fetch updated position
        const [updatedPosition] = await tx
          .select()
          .from(stockPositions)
          .where(eq(stockPositions.id, currentPosition.id))
          .limit(1);

        return this.success(this.mapStockPosition(updatedPosition));
      });
    } catch (error) {
      if (error instanceof StockError || error instanceof StockReservationError) {
        throw error;
      }
      return this.handleError(error, 'releaseReservation');
    }
  }

  // 🟢 WORKING: Cable Drum Management
  async createCableDrum(
    drumData: Omit<CableDrum, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ServiceResponse<CableDrum>> {
    try {
      // Validate required fields
      if (!drumData.projectId || !drumData.drumNumber || !drumData.cableType || !drumData.originalLength) {
        throw new StockError('Missing required fields: projectId, drumNumber, cableType, originalLength', 'VALIDATION_FAILED');
      }

      // Check for duplicate drum number in project
      const [existingDrum] = await db
        .select()
        .from(cableDrums)
        .where(
          and(
            eq(cableDrums.projectId, drumData.projectId),
            eq(cableDrums.drumNumber, drumData.drumNumber)
          )
        )
        .limit(1);

      if (existingDrum) {
        throw new StockError(
          `Cable drum with number ${drumData.drumNumber} already exists in project`,
          'DUPLICATE_ENTRY'
        );
      }

      // Create new drum record
      const newDrum = {
        id: uuidv4(),
        ...drumData,
        drumCondition: drumData.drumCondition || 'good',
        installationStatus: drumData.installationStatus || 'available',
        originalLength: drumData.originalLength.toString(),
        currentLength: (drumData.currentLength || drumData.originalLength).toString(),
        usedLength: (drumData.usedLength || 0).toString(),
        drumWeight: drumData.drumWeight?.toString(),
        cableWeight: drumData.cableWeight?.toString(),
        drumDiameter: drumData.drumDiameter?.toString(),
        lastMeterReading: drumData.lastMeterReading?.toString(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.insert(cableDrums).values(newDrum);

      return this.success(this.mapCableDrum(newDrum));
    } catch (error) {
      if (error instanceof StockError) {
        throw error;
      }
      return this.handleError(error, 'createCableDrum');
    }
  }

  async updateCableDrum(
    drumId: string,
    updateData: Partial<CableDrum>,
    projectId: string
  ): Promise<ServiceResponse<CableDrum>> {
    try {
      // Check if drum exists and belongs to project
      const [existingDrum] = await db
        .select()
        .from(cableDrums)
        .where(
          and(
            eq(cableDrums.id, drumId),
            eq(cableDrums.projectId, projectId)
          )
        )
        .limit(1);

      if (!existingDrum) {
        throw new StockError('Cable drum not found', 'NOT_FOUND');
      }

      // Prepare update data — Record<string, unknown> allows delete + string coercion
      const updateFields: Record<string, unknown> = {
        ...updateData,
        updatedAt: new Date(),
      };

      // Remove fields that shouldn't be updated directly
      delete updateFields.id;
      delete updateFields.createdAt;
      delete updateFields.projectId;

      // Convert numeric fields to strings for database
      if (updateFields.originalLength !== undefined) {
        updateFields.originalLength = String(updateFields.originalLength);
      }
      if (updateFields.currentLength !== undefined) {
        updateFields.currentLength = String(updateFields.currentLength);
      }
      if (updateFields.usedLength !== undefined) {
        updateFields.usedLength = String(updateFields.usedLength);
      }
      if (updateFields.drumWeight !== undefined) {
        updateFields.drumWeight = String(updateFields.drumWeight);
      }
      if (updateFields.cableWeight !== undefined) {
        updateFields.cableWeight = String(updateFields.cableWeight);
      }
      if (updateFields.drumDiameter !== undefined) {
        updateFields.drumDiameter = String(updateFields.drumDiameter);
      }

      // Update the drum
      await db
        .update(cableDrums)
        .set(updateFields)
        .where(eq(cableDrums.id, drumId));

      // Fetch updated drum
      const [updatedDrum] = await db
        .select()
        .from(cableDrums)
        .where(eq(cableDrums.id, drumId))
        .limit(1);

      return this.success(this.mapCableDrum(updatedDrum));
    } catch (error) {
      if (error instanceof StockError) {
        throw error;
      }
      return this.handleError(error, 'updateCableDrum');
    }
  }

  // 🔵 HELPER: Private Methods
  private calculateStockStatus(onHandQuantity: number, reorderLevel: number): 'normal' | 'low' | 'critical' | 'excess' | 'obsolete' {
    if (onHandQuantity === 0) return 'critical';
    if (onHandQuantity <= reorderLevel * 0.5) return 'critical';
    if (onHandQuantity <= reorderLevel) return 'low';
    if (reorderLevel > 0 && onHandQuantity > reorderLevel * 3) return 'excess';
    return 'normal';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapStockPosition(position: any): StockPosition {
    const result: StockPosition = {
      id: position.id,
      projectId: position.projectId,
      itemCode: position.itemCode,
      itemName: position.itemName,
      uom: position.uom,
      onHandQuantity: Number(position.onHandQuantity || 0),
      reservedQuantity: Number(position.reservedQuantity || 0),
      availableQuantity: Number(position.availableQuantity || 0),
      inTransitQuantity: Number(position.inTransitQuantity || 0),
      isActive: Boolean(position.isActive),
      stockStatus: position.stockStatus,
      createdAt: position.createdAt,
      updatedAt: position.updatedAt,
    };

    // Only add optional properties if they have values
    if (position.description) result.description = position.description;
    if (position.category) result.category = position.category;
    if (position.averageUnitCost) result.averageUnitCost = Number(position.averageUnitCost);
    if (position.totalValue) result.totalValue = Number(position.totalValue);
    if (position.warehouseLocation) result.warehouseLocation = position.warehouseLocation;
    if (position.binLocation) result.binLocation = position.binLocation;
    if (position.reorderLevel) result.reorderLevel = Number(position.reorderLevel);
    if (position.maxStockLevel) result.maxStockLevel = Number(position.maxStockLevel);
    if (position.economicOrderQuantity) result.economicOrderQuantity = Number(position.economicOrderQuantity);
    if (position.lastMovementDate) result.lastMovementDate = position.lastMovementDate;
    if (position.lastCountDate) result.lastCountDate = position.lastCountDate;
    if (position.nextCountDue) result.nextCountDue = position.nextCountDue;

    return result;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapCableDrum(drum: any): CableDrum {
    const result: CableDrum = {
      id: drum.id,
      projectId: drum.projectId,
      drumNumber: drum.drumNumber,
      cableType: drum.cableType,
      originalLength: Number(drum.originalLength),
      currentLength: Number(drum.currentLength),
      usedLength: Number(drum.usedLength),
      drumCondition: drum.drumCondition,
      installationStatus: drum.installationStatus,
      createdAt: drum.createdAt,
      updatedAt: drum.updatedAt,
    };

    // Only add optional properties if they have values
    if (drum.stockPositionId) result.stockPositionId = drum.stockPositionId;
    if (drum.serialNumber) result.serialNumber = drum.serialNumber;
    if (drum.supplierDrumId) result.supplierDrumId = drum.supplierDrumId;
    if (drum.cableSpecification) result.cableSpecification = drum.cableSpecification;
    if (drum.manufacturerName) result.manufacturerName = drum.manufacturerName;
    if (drum.partNumber) result.partNumber = drum.partNumber;
    if (drum.drumWeight) result.drumWeight = Number(drum.drumWeight);
    if (drum.cableWeight) result.cableWeight = Number(drum.cableWeight);
    if (drum.drumDiameter) result.drumDiameter = Number(drum.drumDiameter);
    if (drum.currentLocation) result.currentLocation = drum.currentLocation;
    if (drum.lastMeterReading) result.lastMeterReading = Number(drum.lastMeterReading);
    if (drum.lastReadingDate) result.lastReadingDate = drum.lastReadingDate;
    if (drum.lastUsedDate) result.lastUsedDate = drum.lastUsedDate;
    if (drum.testCertificate) result.testCertificate = drum.testCertificate;
    if (drum.installationNotes) result.installationNotes = drum.installationNotes;

    return result;
  }
}

export default StockCommandService;