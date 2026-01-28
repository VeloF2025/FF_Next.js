/**
 * Asset Validation Schemas
 *
 * Zod schemas for validating asset-related payloads.
 * Used by API routes and forms.
 */

import { z } from 'zod';
import { AssetStatus } from '../constants/assetStatus';
import { AssetCondition } from '../constants/conditions';
import { MaintenanceType, AssignmentTargetType } from '../constants/maintenanceTypes';

// UUID validation regex
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Common field schemas
const UUIDSchema = z.string().regex(uuidRegex, 'Invalid UUID format');
const DateStringSchema = z.string().refine(
  (val) => {
    const date = new Date(val);
    return !isNaN(date.getTime());
  },
  { message: 'Invalid date format' }
);
const PositiveNumberSchema = z.number().positive('Must be a positive number');
const NonNegativeNumberSchema = z.number().min(0, 'Cannot be negative');

// Status enum schema
const AssetStatusSchema = z.enum([
  AssetStatus.AVAILABLE,
  AssetStatus.ASSIGNED,
  AssetStatus.IN_MAINTENANCE,
  AssetStatus.OUT_FOR_CALIBRATION,
  AssetStatus.RETIRED,
  AssetStatus.DISPOSED,
  AssetStatus.LOST,
  AssetStatus.DAMAGED,
]);

// Condition enum schema
const AssetConditionSchema = z.enum([
  AssetCondition.NEW,
  AssetCondition.EXCELLENT,
  AssetCondition.GOOD,
  AssetCondition.FAIR,
  AssetCondition.POOR,
  AssetCondition.DAMAGED,
  AssetCondition.NON_FUNCTIONAL,
]);

// Maintenance type enum schema
const MaintenanceTypeSchema = z.enum([
  MaintenanceType.CALIBRATION,
  MaintenanceType.PREVENTIVE,
  MaintenanceType.CORRECTIVE,
  MaintenanceType.INSPECTION,
  MaintenanceType.CERTIFICATION,
]);

// Assignment target type enum schema
const AssignmentTargetTypeSchema = z.enum([
  AssignmentTargetType.STAFF,
  AssignmentTargetType.PROJECT,
  AssignmentTargetType.VEHICLE,
  AssignmentTargetType.WAREHOUSE,
]);

// Pass/Fail enum for calibration
const PassFailSchema = z.enum(['pass', 'fail', 'conditional']);

/**
 * Create Asset Schema
 *
 * Validates payload for creating a new asset.
 */
export const CreateAssetSchema = z.object({
  // Required fields
  categoryId: UUIDSchema,
  name: z.string().min(1, 'Name is required').max(255, 'Name too long'),

  // Optional identification
  description: z.string().max(2000).optional(),
  serialNumber: z.string().max(100).optional(),
  barcode: z.string().max(100).optional(),

  // Manufacturer & Model
  manufacturer: z.string().max(255).optional(),
  model: z.string().max(255).optional(),
  modelNumber: z.string().max(100).optional(),

  // Purchase & Warranty
  purchaseDate: DateStringSchema.optional(),
  purchasePrice: NonNegativeNumberSchema.optional(),
  currency: z.string().length(3).optional(),
  supplierId: UUIDSchema.optional(),
  warrantyEndDate: DateStringSchema.optional(),

  // Depreciation
  usefulLifeYears: z.number().int().positive().optional(),
  salvageValue: NonNegativeNumberSchema.optional(),

  // Location
  currentLocation: z.string().max(255).optional(),
  warehouseLocation: z.string().max(100).optional(),
  binLocation: z.string().max(50).optional(),

  // Calibration
  calibrationProvider: z.string().max(255).optional(),
  lastCalibrationDate: DateStringSchema.optional(),
  nextCalibrationDate: DateStringSchema.optional(),

  // Maintenance
  maintenanceIntervalDays: z.number().int().positive().optional(),

  // Metadata
  specifications: z.record(z.unknown()).optional(),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string().max(50)).optional(),
  primaryImageUrl: z.string().url().optional(),

  // Procurement linkage (from GRN/PO workflow)
  poId: UUIDSchema.optional(),
  grnId: UUIDSchema.optional(),
  grnItemId: UUIDSchema.optional(),
  stockItemId: UUIDSchema.optional(),

  // VLM extraction data (from label scanning)
  labelImageUrl: z.string().url().optional(),
  vlmExtractionData: z.record(z.unknown()).optional(),
});

export type CreateAssetInput = z.infer<typeof CreateAssetSchema>;

/**
 * Update Asset Schema
 *
 * Validates payload for updating an existing asset.
 * All fields are optional (partial update).
 */
// Verification status enum
const VerificationStatusSchema = z.enum(['pending', 'verified', 'mismatch']);

export const UpdateAssetSchema = CreateAssetSchema.partial().extend({
  status: AssetStatusSchema.optional(),
  condition: AssetConditionSchema.optional(),

  // Verification fields (from label scanning)
  verificationStatus: VerificationStatusSchema.optional(),
  verificationImageUrl: z.string().url().optional(),
  verificationMismatches: z.array(z.object({
    field: z.string(),
    expected: z.string().nullable(),
    found: z.string().nullable(),
    isMatch: z.boolean(),
  })).optional(),
});

export type UpdateAssetInput = z.infer<typeof UpdateAssetSchema>;

/**
 * Checkout Asset Schema
 *
 * Validates payload for checking out an asset.
 */
export const CheckoutAssetSchema = z.object({
  assetId: UUIDSchema,
  toType: AssignmentTargetTypeSchema,
  toId: UUIDSchema,
  toName: z.string().min(1).max(255),
  toLocation: z.string().max(255).optional(),
  projectId: UUIDSchema.optional(),
  projectName: z.string().max(255).optional(),
  expectedReturnDate: DateStringSchema.optional(),
  conditionAtCheckout: AssetConditionSchema,
  purpose: z.string().max(500).optional(),
  checkoutNotes: z.string().max(2000).optional(),
  authorizedBy: z.string().max(255).optional(),
});

export type CheckoutAssetInput = z.infer<typeof CheckoutAssetSchema>;

/**
 * Checkin Asset Schema
 *
 * Validates payload for checking in an asset.
 */
export const CheckinAssetSchema = z.object({
  assignmentId: UUIDSchema,
  conditionAtCheckin: AssetConditionSchema,
  checkinNotes: z.string().max(2000).optional(),
  newLocation: z.string().max(255).optional(),
  maintenanceRequired: z.boolean().optional(),
});

export type CheckinAssetInput = z.infer<typeof CheckinAssetSchema>;

/**
 * Schedule Maintenance Schema
 *
 * Validates payload for scheduling maintenance.
 */
export const ScheduleMaintenanceSchema = z.object({
  assetId: UUIDSchema,
  maintenanceType: MaintenanceTypeSchema,
  scheduledDate: DateStringSchema,
  dueDate: DateStringSchema.optional(),
  providerName: z.string().max(255).optional(),
  providerContact: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
});

export type ScheduleMaintenanceInput = z.infer<typeof ScheduleMaintenanceSchema>;

/**
 * Complete Maintenance Schema
 *
 * Validates payload for completing a maintenance record.
 */
export const CompleteMaintenanceSchema = z.object({
  maintenanceId: UUIDSchema,
  completedDate: DateStringSchema,
  workPerformed: z.string().min(1, 'Work performed is required').max(5000),
  findings: z.string().max(2000).optional(),
  recommendations: z.string().max(2000).optional(),

  // Calibration specific
  calibrationCertificateNumber: z.string().max(100).optional(),
  calibrationResults: z.record(z.unknown()).optional(),
  passFail: PassFailSchema.optional(),
  nextCalibrationDate: DateStringSchema.optional(),

  // Costs
  laborCost: NonNegativeNumberSchema.optional(),
  partsCost: NonNegativeNumberSchema.optional(),
  invoiceNumber: z.string().max(100).optional(),

  conditionAfter: AssetConditionSchema,
  notes: z.string().max(2000).optional(),
});

export type CompleteMaintenanceInput = z.infer<typeof CompleteMaintenanceSchema>;

/**
 * Asset Filter Schema
 *
 * Validates filter parameters for listing assets.
 */
export const AssetFilterSchema = z.object({
  searchTerm: z.string().max(255).optional(),
  categoryId: z.array(UUIDSchema).optional(),
  categoryType: z.array(z.string()).optional(),
  status: z.array(AssetStatusSchema).optional(),
  condition: z.array(AssetConditionSchema).optional(),
  assigneeType: AssignmentTargetTypeSchema.optional(),
  assigneeId: UUIDSchema.optional(),
  isAssigned: z.boolean().optional(),
  requiresCalibration: z.boolean().optional(),
  isCalibrationOverdue: z.boolean().optional(),
  calibrationDueWithinDays: z.number().int().positive().optional(),
  isUnderWarranty: z.boolean().optional(),
  warehouseLocation: z.string().optional(),
  tags: z.array(z.string()).optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export type AssetFilterInput = z.infer<typeof AssetFilterSchema>;

/**
 * Maintenance Filter Schema
 *
 * Validates filter parameters for listing maintenance records.
 */
export const MaintenanceFilterSchema = z.object({
  assetId: UUIDSchema.optional(),
  maintenanceType: z.array(MaintenanceTypeSchema).optional(),
  status: z.array(z.enum(['scheduled', 'in_progress', 'completed', 'overdue', 'cancelled'])).optional(),
  scheduledDateFrom: DateStringSchema.optional(),
  scheduledDateTo: DateStringSchema.optional(),
  isOverdue: z.boolean().optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export type MaintenanceFilterInput = z.infer<typeof MaintenanceFilterSchema>;

/**
 * Category Schema
 *
 * Validates payload for creating/updating asset categories.
 */
export const CategorySchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20).regex(/^[A-Z0-9_]+$/, 'Code must be uppercase alphanumeric'),
  type: z.string(),
  description: z.string().max(500).optional(),
  requiresCalibration: z.boolean().optional(),
  calibrationIntervalDays: z.number().int().positive().optional(),
  depreciationYears: z.number().int().positive().optional(),
});

export type CategoryInput = z.infer<typeof CategorySchema>;
