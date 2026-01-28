/**
 * Core Asset Types
 *
 * Defines the main Asset entity and related interfaces.
 */

import type { AssetStatusType } from '../constants/assetStatus';
import type { AssetCategoryTypeValue } from '../constants/assetCategories';
import type { AssetConditionType } from '../constants/conditions';
import type { AssignmentTargetTypeValue } from '../constants/maintenanceTypes';

/**
 * Asset Category - template for asset types
 */
export interface AssetCategory {
  id: string;
  name: string;
  code: string;
  type: AssetCategoryTypeValue;
  description?: string;
  requiresCalibration: boolean;
  calibrationIntervalDays?: number;
  depreciationYears?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Main Asset Entity
 */
export interface Asset {
  id: string;

  // Identification
  assetNumber: string;
  serialNumber?: string;
  barcode?: string;
  qrCodeUrl?: string;

  // Classification
  categoryId: string;
  category?: AssetCategory;
  name: string;
  description?: string;

  // Manufacturer & Model
  manufacturer?: string;
  model?: string;
  modelNumber?: string;

  // Purchase & Warranty
  purchaseDate?: Date;
  purchasePrice?: number;
  currency: string;
  supplierId?: string;
  warrantyEndDate?: Date;
  isUnderWarranty?: boolean;

  // Depreciation
  usefulLifeYears?: number;
  salvageValue: number;
  currentBookValue?: number;
  accumulatedDepreciation?: number;

  // Status & Condition
  status: AssetStatusType;
  condition: AssetConditionType;
  currentLocation?: string;
  warehouseLocation?: string;
  binLocation?: string;

  // Current Assignment (denormalized for quick lookups)
  currentAssigneeType?: AssignmentTargetTypeValue;
  currentAssigneeId?: string;
  currentAssigneeName?: string;
  assignedSince?: Date;

  // Calibration
  requiresCalibration: boolean;
  lastCalibrationDate?: Date;
  nextCalibrationDate?: Date;
  calibrationProvider?: string;
  isCalibrationOverdue?: boolean;

  // Maintenance
  lastMaintenanceDate?: Date;
  nextMaintenanceDate?: Date;
  maintenanceIntervalDays?: number;

  // Disposal
  disposalDate?: Date;
  disposalMethod?: string;
  disposalValue?: number;
  disposalNotes?: string;
  disposedBy?: string;

  // Metadata
  specifications?: Record<string, unknown>;
  notes?: string;
  tags: string[];
  primaryImageUrl?: string;
  imageUrls?: string[];

  // Procurement Links (Sprint 4)
  poId?: string;
  poNumber?: string;
  grnId?: string;
  grnNumber?: string;
  stockItemId?: string;

  // VLM Extraction (Sprint 4)
  labelImageUrl?: string;
  vlmExtractedAt?: Date;
  vlmExtractionData?: Record<string, unknown>;

  // Verification (Sprint 4)
  verificationStatus?: 'verified' | 'mismatch' | 'pending';
  verifiedAt?: Date;
  verifiedBy?: string;
  verificationImageUrl?: string;
  verificationMismatches?: Array<{
    field: string;
    expected: string | null;
    found: string | null;
  }>;

  // Odoo Sync (Sprint 3)
  odooProductId?: number;
  odooVehicleId?: number;

  // Audit
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy?: string;
}

/**
 * Asset with category populated
 */
export interface AssetWithCategory extends Asset {
  category: AssetCategory;
}

/**
 * Asset list item (lighter version for tables)
 */
export interface AssetListItem {
  id: string;
  assetNumber: string;
  name: string;
  categoryId: string;
  categoryName?: string;
  categoryType?: AssetCategoryTypeValue;
  status: AssetStatusType;
  condition: AssetConditionType;
  currentAssigneeName?: string;
  currentLocation?: string;
  nextCalibrationDate?: Date;
  isCalibrationOverdue?: boolean;
  createdAt: Date;
}

/**
 * Asset filter options
 */
export interface AssetFilter {
  searchTerm?: string;
  categoryId?: string[];
  categoryType?: AssetCategoryTypeValue[];
  status?: AssetStatusType[];
  condition?: AssetConditionType[];
  assigneeType?: AssignmentTargetTypeValue;
  assigneeId?: string;
  isAssigned?: boolean;
  requiresCalibration?: boolean;
  isCalibrationOverdue?: boolean;
  calibrationDueWithinDays?: number;
  isUnderWarranty?: boolean;
  warehouseLocation?: string;
  tags?: string[];
  page?: number;
  limit?: number;
  sortBy?: keyof Asset;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Asset creation payload
 */
export interface CreateAssetPayload {
  categoryId: string;
  name: string;
  description?: string;
  serialNumber?: string;
  barcode?: string;
  manufacturer?: string;
  model?: string;
  modelNumber?: string;
  purchaseDate?: string | Date;
  purchasePrice?: number;
  currency?: string;
  supplierId?: string;
  warrantyEndDate?: string | Date;
  usefulLifeYears?: number;
  salvageValue?: number;
  currentLocation?: string;
  warehouseLocation?: string;
  binLocation?: string;
  calibrationProvider?: string;
  lastCalibrationDate?: string | Date;
  nextCalibrationDate?: string | Date;
  maintenanceIntervalDays?: number;
  specifications?: Record<string, unknown>;
  notes?: string;
  tags?: string[];
  primaryImageUrl?: string;
}

/**
 * Asset update payload
 */
export interface UpdateAssetPayload extends Partial<CreateAssetPayload> {
  status?: AssetStatusType;
  condition?: AssetConditionType;
}

/**
 * Paginated asset response
 */
export interface PaginatedAssets {
  data: AssetListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
