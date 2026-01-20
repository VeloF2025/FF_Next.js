/**
 * Fleet Vehicle Check-In Types
 * Daily and Weekly pre-trip inspection system with VLM integration
 */

// ============================================================================
// Enums / Union Types
// ============================================================================

/**
 * Check type - daily quick check vs weekly comprehensive inspection
 */
export type CheckType = 'daily' | 'weekly';

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
export type CheckPhotoType =
  | 'front'
  | 'rear'
  | 'dashboard'
  | 'damage'
  | 'fuel_gauge'
  | 'under_vehicle'
  | 'license_disk';

/**
 * Check item categories
 */
export type CheckItemCategory = 'safety' | 'mechanical' | 'exterior' | 'interior';

/**
 * VLM analysis types
 */
export type VlmAnalysisType = 'odometer' | 'license_plate' | 'fuel_gauge' | 'fuel_receipt' | 'damage';

/**
 * VLM processing status
 */
export type VlmProcessingStatus = 'pending' | 'completed' | 'failed';

/**
 * Odometer reading source
 */
export type OdometerSource = 'manual' | 'vlm';

/**
 * Reminder channel
 */
export type ReminderChannel = 'email' | 'whatsapp';

/**
 * Reminder delivery status
 */
export type ReminderDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

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
  checkType: CheckType;
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

  // Check type and details
  checkType: CheckType;
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
  checkType?: CheckType; // Defaults to 'daily'
  odometerReading?: number;
  fuelLevel?: number; // 0-100 percentage
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
  checkType?: CheckType;
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
  checkType: CheckType;
  checkDate: string;
  checkTime: string;
  odometerReading: number | null;
  fuelLevel: number | null;
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
  checkType: CheckType;
  checkDate: string;
  checkTime: string;
  odometerReading: number | null;
  fuelLevel: number | null;
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
// VLM Analysis Types
// ============================================================================

/**
 * VLM photo analysis result
 */
export interface VlmPhotoResult {
  id: string;
  photoId: string;
  analysisType: VlmAnalysisType;
  extractedValue: string | null;
  extractedNumeric: number | null;
  confidence: number | null;
  plateMatchesVehicle: boolean | null;
  expectedPlate: string | null;
  vlmModel: string | null;
  rawResponse: string | null;
  processingTimeMs: number | null;
  processingStatus: VlmProcessingStatus;
  errorMessage: string | null;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  overrideValue: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * VLM extraction result for odometer
 */
export interface OdometerExtractionResult {
  reading: number | null;
  confidence: number;
  rawText: string;
  error?: string;
  /** Warning message if digit confusion or mismatch detected */
  warning?: string;
  /** Raw VLM response(s) for debugging */
  rawResponse?: string;
}

/**
 * VLM extraction result for license plate
 */
export interface LicensePlateExtractionResult {
  plateText: string | null;
  matches: boolean;
  confidence: number;
  expectedPlate: string;
  error?: string;
}

/**
 * VLM extraction result for fuel gauge
 */
export interface FuelGaugeExtractionResult {
  level: number | null; // 0-100 percentage
  confidence: number;
  description: string; // "Empty", "Quarter", "Half", "Three-quarters", "Full"
  error?: string;
}

/**
 * VLM extraction result for fuel receipt OCR
 * Extracts: amount, litres, price per litre, date, station name/location
 */
export interface FuelReceiptExtractionResult {
  amountRand: number | null;
  litres: number | null;
  pricePerLitre: number | null;
  date: string | null; // YYYY-MM-DD format
  stationName: string | null;
  stationLocation: string | null;
  fuelType: string | null; // 93, 95, Diesel
  confidence: number;
  error?: string;
}

/**
 * VLM extraction result for licence disk OCR
 * South African licence disk contains: VIN, Engine No, Make, Description, Tare, GVM, Expiry
 */
export interface LicenseDiskExtractionResult {
  registration: string | null;
  vin: string | null;
  engineNumber: string | null;
  make: string | null;
  description: string | null; // Model/description
  year: number | null;
  tare: number | null; // Tare mass in kg
  gvm: number | null; // Gross Vehicle Mass in kg
  licenseExpiry: string | null; // YYYY-MM-DD format
  color: string | null;
  confidence: number;
  rawText: string;
  error?: string;
}

// ============================================================================
// Odometer & Fuel History Types
// ============================================================================

/**
 * Odometer reading history entry
 */
export interface OdometerHistory {
  id: string;
  vehicleId: string;
  checkRecordId: string | null;
  reading: number;
  source: OdometerSource;
  vlmConfidence: number | null;
  previousReading: number | null;
  kmSinceLast: number | null;
  discrepancyFlag: boolean;
  discrepancyReason: string | null;
  recordedAt: string;
  createdAt: string;
}

/**
 * Fuel level history entry
 */
export interface FuelHistory {
  id: string;
  vehicleId: string;
  checkRecordId: string | null;
  fuelLevel: number; // 0-100
  source: OdometerSource;
  vlmConfidence: number | null;
  previousLevel: number | null;
  levelChange: number | null;
  recordedAt: string;
  createdAt: string;
}

/**
 * Odometer comparison result (current vs previous)
 */
export interface OdometerComparison {
  current: number;
  previous: number | null;
  kmSinceLast: number | null;
  daysElapsed: number | null;
  avgKmPerDay: number | null;
  isDiscrepancy: boolean;
  discrepancyReason: string | null;
  threshold: number;
}

/**
 * Fuel level comparison result
 */
export interface FuelComparison {
  current: number;
  previous: number | null;
  change: number | null;
  description: string;
}

// ============================================================================
// Check Schedule & Reminder Types
// ============================================================================

/**
 * Vehicle check schedule tracking
 */
export interface CheckSchedule {
  vehicleId: string;
  dailyLastCheck: string | null;
  weeklyLastCheck: string | null;
  weeklyDueDay: number; // 1=Monday, 7=Sunday
  reminderSentDaily: boolean;
  reminderSentWeekly: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Check reminder log entry
 */
export interface CheckReminder {
  id: string;
  vehicleId: string;
  driverId: string;
  checkType: CheckType;
  reminderChannel: ReminderChannel;
  messageId: string | null;
  deliveryStatus: ReminderDeliveryStatus;
  sentAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}

/**
 * Vehicle threshold configuration
 */
export interface VehicleThreshold {
  vehicleId: string;
  dailyKmThreshold: number;
  weeklyKmThreshold: number;
  learnedAvgDailyKm: number | null;
  learnedStdDeviation: number | null;
  lastLearningUpdate: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Daily vs Weekly Check Configuration
// ============================================================================

/**
 * Daily check requirements (minimal)
 */
export interface DailyCheckConfig {
  checkType: 'daily';
  requiredPhotos: Array<{ type: CheckPhotoType; label: string; vlmType: VlmAnalysisType | null }>;
  checklistItems: never[]; // No checklist for daily
}

/**
 * Weekly check requirements (comprehensive)
 */
export interface WeeklyCheckConfig {
  checkType: 'weekly';
  requiredPhotos: Array<{ type: CheckPhotoType; label: string; vlmType: VlmAnalysisType | null }>;
  categories: Array<{
    name: string;
    items: Array<{ id: string; name: string; isCritical: boolean }>;
  }>;
}

// ============================================================================
// Database Row Types (for API mapping)
// ============================================================================

export interface FleetCheckTemplateRow {
  id: string;
  name: string;
  description: string | null;
  check_type: string;
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
  check_type: string;
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

export interface FleetOdometerHistoryRow {
  id: string;
  vehicle_id: string;
  check_record_id: string | null;
  reading: number;
  source: string;
  vlm_confidence: string | null;
  previous_reading: number | null;
  km_since_last: number | null;
  discrepancy_flag: boolean;
  discrepancy_reason: string | null;
  recorded_at: string;
  created_at: string;
}

export interface FleetFuelHistoryRow {
  id: string;
  vehicle_id: string;
  check_record_id: string | null;
  fuel_level: number;
  source: string;
  vlm_confidence: string | null;
  previous_level: number | null;
  level_change: number | null;
  recorded_at: string;
  created_at: string;
}

export interface FleetPhotoVlmResultRow {
  id: string;
  photo_id: string;
  analysis_type: string;
  extracted_value: string | null;
  extracted_numeric: number | null;
  confidence: string | null;
  plate_matches_vehicle: boolean | null;
  expected_plate: string | null;
  vlm_model: string | null;
  raw_response: string | null;
  processing_time_ms: number | null;
  processing_status: string;
  error_message: string | null;
  verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  override_value: string | null;
  created_at: string;
  updated_at: string;
}

export interface FleetCheckScheduleRow {
  vehicle_id: string;
  daily_last_check: string | null;
  weekly_last_check: string | null;
  weekly_due_day: number;
  reminder_sent_daily: boolean;
  reminder_sent_weekly: boolean;
  created_at: string;
  updated_at: string;
}

export interface FleetCheckReminderRow {
  id: string;
  vehicle_id: string;
  driver_id: string;
  check_type: string;
  reminder_channel: string;
  message_id: string | null;
  delivery_status: string;
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

export interface FleetVehicleThresholdRow {
  vehicle_id: string;
  daily_km_threshold: number;
  weekly_km_threshold: number;
  learned_avg_daily_km: number | null;
  learned_std_deviation: number | null;
  last_learning_update: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Row to Type Converters
// ============================================================================

export function rowToCheckTemplate(row: FleetCheckTemplateRow): CheckTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    checkType: (row.check_type || 'daily') as CheckType,
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
    checkType: (row.check_type || 'daily') as CheckType,
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

// New row converters for VLM and history tables

export function rowToOdometerHistory(row: FleetOdometerHistoryRow): OdometerHistory {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    checkRecordId: row.check_record_id,
    reading: row.reading,
    source: row.source as OdometerSource,
    vlmConfidence: row.vlm_confidence ? parseFloat(row.vlm_confidence) : null,
    previousReading: row.previous_reading,
    kmSinceLast: row.km_since_last,
    discrepancyFlag: row.discrepancy_flag,
    discrepancyReason: row.discrepancy_reason,
    recordedAt: row.recorded_at,
    createdAt: row.created_at,
  };
}

export function rowToFuelHistory(row: FleetFuelHistoryRow): FuelHistory {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    checkRecordId: row.check_record_id,
    fuelLevel: row.fuel_level,
    source: row.source as OdometerSource,
    vlmConfidence: row.vlm_confidence ? parseFloat(row.vlm_confidence) : null,
    previousLevel: row.previous_level,
    levelChange: row.level_change,
    recordedAt: row.recorded_at,
    createdAt: row.created_at,
  };
}

export function rowToVlmPhotoResult(row: FleetPhotoVlmResultRow): VlmPhotoResult {
  return {
    id: row.id,
    photoId: row.photo_id,
    analysisType: row.analysis_type as VlmAnalysisType,
    extractedValue: row.extracted_value,
    extractedNumeric: row.extracted_numeric,
    confidence: row.confidence ? parseFloat(row.confidence) : null,
    plateMatchesVehicle: row.plate_matches_vehicle,
    expectedPlate: row.expected_plate,
    vlmModel: row.vlm_model,
    rawResponse: row.raw_response,
    processingTimeMs: row.processing_time_ms,
    processingStatus: row.processing_status as VlmProcessingStatus,
    errorMessage: row.error_message,
    verified: row.verified,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    overrideValue: row.override_value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToCheckSchedule(row: FleetCheckScheduleRow): CheckSchedule {
  return {
    vehicleId: row.vehicle_id,
    dailyLastCheck: row.daily_last_check,
    weeklyLastCheck: row.weekly_last_check,
    weeklyDueDay: row.weekly_due_day,
    reminderSentDaily: row.reminder_sent_daily,
    reminderSentWeekly: row.reminder_sent_weekly,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToCheckReminder(row: FleetCheckReminderRow): CheckReminder {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    driverId: row.driver_id,
    checkType: row.check_type as CheckType,
    reminderChannel: row.reminder_channel as ReminderChannel,
    messageId: row.message_id,
    deliveryStatus: row.delivery_status as ReminderDeliveryStatus,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
  };
}

export function rowToVehicleThreshold(row: FleetVehicleThresholdRow): VehicleThreshold {
  return {
    vehicleId: row.vehicle_id,
    dailyKmThreshold: row.daily_km_threshold,
    weeklyKmThreshold: row.weekly_km_threshold,
    learnedAvgDailyKm: row.learned_avg_daily_km,
    learnedStdDeviation: row.learned_std_deviation,
    lastLearningUpdate: row.last_learning_update,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// Required Photos Configuration
// ============================================================================

/**
 * Photos required for daily check (minimal)
 */
export const DAILY_REQUIRED_PHOTOS: Array<{
  type: CheckPhotoType;
  label: string;
  required: boolean;
  vlmType: VlmAnalysisType | null;
}> = [
  { type: 'dashboard', label: 'Dashboard/Odometer', required: true, vlmType: 'odometer' },
  { type: 'fuel_gauge', label: 'Fuel Gauge', required: true, vlmType: 'fuel_gauge' },
];

/**
 * Photos required for weekly check (comprehensive)
 */
export const WEEKLY_REQUIRED_PHOTOS: Array<{
  type: CheckPhotoType;
  label: string;
  required: boolean;
  vlmType: VlmAnalysisType | null;
}> = [
  { type: 'front', label: 'Exterior Front (License Plate)', required: true, vlmType: 'license_plate' },
  { type: 'rear', label: 'Exterior Rear (License Plate)', required: true, vlmType: 'license_plate' },
  { type: 'dashboard', label: 'Dashboard/Odometer', required: true, vlmType: 'odometer' },
  { type: 'fuel_gauge', label: 'Fuel Gauge', required: true, vlmType: 'fuel_gauge' },
  { type: 'under_vehicle', label: 'Under Vehicle (Leaks Check)', required: false, vlmType: null },
  { type: 'license_disk', label: 'License Disk', required: false, vlmType: null },
  { type: 'damage', label: 'Damage Photo (if any)', required: false, vlmType: 'damage' },
];

/**
 * Legacy photo configuration for backward compatibility
 * @deprecated Use DAILY_REQUIRED_PHOTOS or WEEKLY_REQUIRED_PHOTOS
 */
export const REQUIRED_PHOTOS: Array<{ type: CheckPhotoType; label: string; required: boolean }> = [
  { type: 'front', label: 'Exterior Front', required: true },
  { type: 'rear', label: 'Exterior Rear', required: true },
  { type: 'dashboard', label: 'Dashboard/Odometer', required: true },
  { type: 'damage', label: 'Damage Photo', required: false },
];

/**
 * Get required photos based on check type
 */
export function getRequiredPhotosForCheckType(checkType: CheckType) {
  return checkType === 'daily' ? DAILY_REQUIRED_PHOTOS : WEEKLY_REQUIRED_PHOTOS;
}
