/**
 * Fleet Vehicle Check-In Types
 * Daily pre-trip inspection system
 */

// ============================================================================
// Enums / Union Types
// ============================================================================

/**
 * Issue severity when a check item fails
 */
export type IssueSeverity = 'minor' | 'critical';

/**
 * Check record status in approval workflow
 */
export type CheckRecordStatus = 'pending' | 'approved' | 'rejected';

/**
 * Offline sync status
 */
export type SyncStatus = 'pending' | 'synced' | 'conflict';

/**
 * Photo types for vehicle check-in
 */
export type CheckPhotoType = 'front' | 'rear' | 'dashboard' | 'damage';

/**
 * Check item categories
 */
export type CheckItemCategory = 'safety' | 'mechanical' | 'exterior' | 'interior';

// ============================================================================
// Core Interfaces
// ============================================================================

/**
 * Check template - admin-configurable checklist
 */
export interface CheckTemplate {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Check item - individual checklist item
 */
export interface CheckItem {
  id: string;
  templateId: string;
  name: string;
  description: string | null;
  category: CheckItemCategory | null;
  isCritical: boolean; // If failed, blocks vehicle use
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
}

/**
 * Check record - completed check-in
 */
export interface CheckRecord {
  id: string;
  vehicleId: string;
  templateId: string | null;
  driverId: string;
  driverName: string;

  // Check details
  checkDate: string; // YYYY-MM-DD
  checkTime: string; // HH:MM:SS
  odometerReading: number | null;

  // Status
  status: CheckRecordStatus;
  hasCriticalIssues: boolean;
  hasMinorIssues: boolean;

  // Approval workflow
  approvedBy: string | null;
  approvedAt: string | null;
  approvalNotes: string | null;

  // Offline sync
  syncStatus: SyncStatus;
  offlineId: string | null;

  // Metadata
  createdAt: string;
  updatedAt: string;
}

/**
 * Check response - individual item pass/fail
 */
export interface CheckResponse {
  id: string;
  recordId: string;
  itemId: string;
  isPassed: boolean;
  severity: IssueSeverity | null; // null if passed
  notes: string | null;
  createdAt: string;
}

/**
 * Check photo - captured photo
 */
export interface CheckPhoto {
  id: string;
  recordId: string;
  responseId: string | null; // null for standard photos
  photoType: CheckPhotoType;
  isRequired: boolean;
  fileUrl: string;
  filePath: string | null;
  fileSize: number | null;
  capturedAt: string;
  latitude: number | null;
  longitude: number | null;
}

// ============================================================================
// Extended Interfaces (with relations)
// ============================================================================

/**
 * Check template with items
 */
export interface CheckTemplateWithItems extends CheckTemplate {
  items: CheckItem[];
}

/**
 * Check record with full details
 */
export interface CheckRecordWithDetails extends CheckRecord {
  vehicle: {
    registration: string;
    make: string | null;
    model: string | null;
  };
  responses: CheckResponseWithItem[];
  photos: CheckPhoto[];
}

/**
 * Check response with item details
 */
export interface CheckResponseWithItem extends CheckResponse {
  item: CheckItem;
}

// ============================================================================
// Form / Input Types
// ============================================================================

/**
 * Input for creating a check record
 */
export interface CreateCheckRecordInput {
  vehicleId: string;
  templateId?: string;
  driverId: string;
  driverName: string;
  odometerReading?: number;
  responses: CreateCheckResponseInput[];
  offlineId?: string; // For offline sync
}

/**
 * Input for a single check response
 */
export interface CreateCheckResponseInput {
  itemId: string;
  isPassed: boolean;
  severity?: IssueSeverity;
  notes?: string;
}

/**
 * Input for uploading a photo
 */
export interface CreateCheckPhotoInput {
  recordId: string;
  responseId?: string;
  photoType: CheckPhotoType;
  file: File;
  latitude?: number;
  longitude?: number;
}

/**
 * Input for creating/updating a template
 */
export interface CreateTemplateInput {
  name: string;
  description?: string;
  isDefault?: boolean;
}

/**
 * Input for creating/updating a check item
 */
export interface CreateCheckItemInput {
  templateId: string;
  name: string;
  description?: string;
  category?: CheckItemCategory;
  isCritical?: boolean;
  displayOrder?: number;
}

// ============================================================================
// Offline Sync Types
// ============================================================================

/**
 * Offline check-in stored in IndexedDB
 */
export interface OfflineCheckRecord {
  offlineId: string;
  vehicleId: string;
  templateId: string | null;
  driverId: string;
  driverName: string;
  checkDate: string;
  checkTime: string;
  odometerReading: number | null;
  responses: CreateCheckResponseInput[];
  photos: OfflinePhoto[];
  createdAt: string;
  syncAttempts: number;
  lastSyncError: string | null;
}

/**
 * Photo stored offline (base64 or blob)
 */
export interface OfflinePhoto {
  id: string;
  photoType: CheckPhotoType;
  responseId?: string;
  dataUrl: string; // Base64 encoded image
  latitude: number | null;
  longitude: number | null;
  capturedAt: string;
}

/**
 * Sync request payload
 */
export interface SyncCheckRecordRequest {
  offlineId: string;
  vehicleId: string;
  templateId: string | null;
  driverId: string;
  driverName: string;
  checkDate: string;
  checkTime: string;
  odometerReading: number | null;
  responses: CreateCheckResponseInput[];
  photos: Array<{
    photoType: CheckPhotoType;
    responseId?: string;
    dataUrl: string;
    latitude: number | null;
    longitude: number | null;
    capturedAt: string;
  }>;
}

/**
 * Sync response
 */
export interface SyncCheckRecordResponse {
  success: boolean;
  recordId?: string;
  offlineId: string;
  error?: string;
}

// ============================================================================
// Vehicle Availability Check
// ============================================================================

/**
 * Result of checking if vehicle can be used
 */
export interface VehicleAvailabilityResult {
  canUse: boolean;
  reason?: string;
  criticalIssues: string[];
  minorIssues: string[];
  lastCheckIn?: {
    id: string;
    checkDate: string;
    checkTime: string;
    driverName: string;
    status: CheckRecordStatus;
  };
}

// ============================================================================
// Database Row Types (for API mapping)
// ============================================================================

export interface FleetCheckTemplateRow {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FleetCheckItemRow {
  id: string;
  template_id: string;
  name: string;
  description: string | null;
  category: string | null;
  is_critical: boolean;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

export interface FleetCheckRecordRow {
  id: string;
  vehicle_id: string;
  template_id: string | null;
  driver_id: string;
  driver_name: string;
  check_date: string;
  check_time: string;
  odometer_reading: number | null;
  status: string;
  has_critical_issues: boolean;
  has_minor_issues: boolean;
  approved_by: string | null;
  approved_at: string | null;
  approval_notes: string | null;
  sync_status: string;
  offline_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FleetCheckResponseRow {
  id: string;
  record_id: string;
  item_id: string;
  is_passed: boolean;
  severity: string | null;
  notes: string | null;
  created_at: string;
}

export interface FleetCheckPhotoRow {
  id: string;
  record_id: string;
  response_id: string | null;
  photo_type: string;
  is_required: boolean;
  file_url: string;
  file_path: string | null;
  file_size: number | null;
  captured_at: string;
  latitude: string | null;
  longitude: string | null;
}

// ============================================================================
// Row to Type Converters
// ============================================================================

export function rowToCheckTemplate(row: FleetCheckTemplateRow): CheckTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isDefault: row.is_default,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToCheckItem(row: FleetCheckItemRow): CheckItem {
  return {
    id: row.id,
    templateId: row.template_id,
    name: row.name,
    description: row.description,
    category: row.category as CheckItemCategory | null,
    isCritical: row.is_critical,
    displayOrder: row.display_order,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export function rowToCheckRecord(row: FleetCheckRecordRow): CheckRecord {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    templateId: row.template_id,
    driverId: row.driver_id,
    driverName: row.driver_name,
    checkDate: row.check_date,
    checkTime: row.check_time,
    odometerReading: row.odometer_reading,
    status: row.status as CheckRecordStatus,
    hasCriticalIssues: row.has_critical_issues,
    hasMinorIssues: row.has_minor_issues,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    approvalNotes: row.approval_notes,
    syncStatus: row.sync_status as SyncStatus,
    offlineId: row.offline_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToCheckResponse(row: FleetCheckResponseRow): CheckResponse {
  return {
    id: row.id,
    recordId: row.record_id,
    itemId: row.item_id,
    isPassed: row.is_passed,
    severity: row.severity as IssueSeverity | null,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export function rowToCheckPhoto(row: FleetCheckPhotoRow): CheckPhoto {
  return {
    id: row.id,
    recordId: row.record_id,
    responseId: row.response_id,
    photoType: row.photo_type as CheckPhotoType,
    isRequired: row.is_required,
    fileUrl: row.file_url,
    filePath: row.file_path,
    fileSize: row.file_size,
    capturedAt: row.captured_at,
    latitude: row.latitude ? parseFloat(row.latitude) : null,
    longitude: row.longitude ? parseFloat(row.longitude) : null,
  };
}

// ============================================================================
// Required Photos Configuration
// ============================================================================

export const REQUIRED_PHOTOS: Array<{ type: CheckPhotoType; label: string; required: boolean }> = [
  { type: 'front', label: 'Exterior Front', required: true },
  { type: 'rear', label: 'Exterior Rear', required: true },
  { type: 'dashboard', label: 'Dashboard/Odometer', required: true },
  { type: 'damage', label: 'Damage Photo', required: false },
];
