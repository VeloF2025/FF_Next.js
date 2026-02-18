/**
 * Stock Core Types - Main stock position and movement definitions
 */

import { StockStatusType, MovementTypeType, MovementStatusType, ItemStatusType, QualityCheckStatusType, SerialStatusValue, BinTypeValue } from './enums.types';

// Stock Position interface matching database schema
export interface StockPosition {
  id: string;
  projectId: string;
  
  // Item Details
  itemCode: string;
  itemName: string;
  description?: string;
  category?: string;
  uom: string;
  
  // Stock Quantities
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  inTransitQuantity: number;
  
  // Valuation
  averageUnitCost?: number;
  totalValue?: number;
  
  // Location
  warehouseLocation?: string;
  binLocation?: string;
  
  // Reorder Information
  reorderLevel?: number;
  maxStockLevel?: number;
  economicOrderQuantity?: number;
  
  // Tracking
  lastMovementDate?: Date;
  lastCountDate?: Date;
  nextCountDue?: Date;
  
  // Status
  isActive: boolean;
  stockStatus: StockStatusType;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// Stock Movement interface matching database schema
export interface StockMovement {
  id: string;
  projectId: string;
  
  // Movement Details
  movementType: MovementTypeType;
  referenceNumber: string;
  referenceType?: string; // PO, RFQ, WORK_ORDER, MANUAL
  referenceId?: string;
  
  // Locations
  fromLocation?: string;
  toLocation?: string;
  fromProjectId?: string;
  toProjectId?: string;
  
  // Status and Dates
  status: MovementStatusType;
  movementDate: Date;
  confirmedAt?: Date;
  
  // Personnel
  requestedBy?: string;
  authorizedBy?: string;
  processedBy?: string;
  
  // Notes and Documentation
  notes?: string;
  reason?: string;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// Stock Movement Item interface matching database schema
export interface StockMovementItem {
  id: string;
  movementId: string;
  stockPositionId?: string;
  projectId: string;
  
  // Item Details
  itemCode: string;
  itemName: string;
  description?: string;
  uom: string;
  
  // Quantities
  plannedQuantity: number;
  actualQuantity?: number;
  receivedQuantity?: number;
  
  // Costing
  unitCost?: number;
  totalCost?: number;
  
  // Lot/Serial Tracking
  lotNumbers?: string[]; // Array of lot numbers
  serialNumbers?: string[]; // Array of serial numbers
  
  // Status
  itemStatus: ItemStatusType;
  
  // Quality Control
  qualityCheckRequired: boolean;
  qualityCheckStatus?: QualityCheckStatusType;
  qualityNotes?: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// ============= Serial & Bin Types =============

/** Represents a state transition for a serialized item */
export interface SerialStateTransition {
  fromStatus: SerialStatusValue;
  toStatus: SerialStatusValue;
  triggeredBy: string;
  reason?: string;
  faultReportId?: string;
}

/** Stock serial record — individual serialized unit */
export interface StockSerial {
  id: string;
  stockPositionId: string;
  projectId: string;

  // Serial Details
  serialNumber: string;
  itemCode: string;
  itemName?: string;

  // Status
  status: SerialStatusValue;

  // Location
  binId?: string;
  binType?: BinTypeValue;
  assignedTo?: string;

  // Provenance
  purchaseOrderId?: string;
  grnId?: string;
  batchNumber?: string;
  supplierId?: string;

  // Installation
  installedAt?: Date;
  installedBy?: string;
  installedLocation?: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/** Storage bin / location record */
export interface StockBin {
  id: string;
  projectId: string;
  binCode: string;
  binName: string;
  binType: BinTypeValue;
  parentBinId?: string;
  assignedTo?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}