/**
 * Fleet Fuel Analytics Types
 * Types for fuel consumption tracking, cost analysis, and anomaly detection
 */

// ============================================================================
// Fuel Transaction Types
// ============================================================================

export interface FuelTransaction {
  id: string;
  vehicleId: string;
  transactionDate: string;
  amountRand: number;
  litres: number;
  pricePerLitre: number;
  odometerReading: number | null;
  kmSinceLastFill: number | null;
  litresPer100km: number | null;
  stationName: string | null;
  stationLocation: string | null;
  receiptPhotoUrl: string | null;
  odometerPhotoUrl: string | null;
  vlmExtracted: boolean;
  vlmConfidence: number | null;
  source: string | null;
  recordedBy: string | null;
  createdAt: string;
}

export interface FuelTransactionWithVehicle extends FuelTransaction {
  registration: string;
  make: string | null;
  model: string | null;
  driverName: string | null;
}

// ============================================================================
// Fuel Anomaly Types
// ============================================================================

export type AnomalyType =
  | 'sudden_drop'        // Fuel level dropped significantly without transaction
  | 'high_consumption'   // Consumption much higher than expected
  | 'low_consumption'    // Consumption suspiciously low (potential odometer tampering)
  | 'impossible_fill'    // Fill amount exceeds tank capacity
  | 'odometer_mismatch'  // Odometer reading doesn't match distance traveled
  | 'frequent_fills'     // Too many fill-ups in short period
  | 'price_anomaly';     // Price per litre outside normal range

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';

export type AnomalyStatus = 'detected' | 'investigating' | 'resolved' | 'dismissed';

export interface FuelAnomaly {
  id: string;
  vehicleId: string;
  detectedAt: string;
  anomalyType: AnomalyType;
  severity: AnomalySeverity;
  fuelLevelBefore: number | null;
  fuelLevelAfter: number | null;
  expectedConsumption: number | null;
  actualConsumption: number | null;
  deviationPercentage: number | null;
  locationLat: number | null;
  locationLon: number | null;
  locationName: string | null;
  relatedTransactionId: string | null;
  relatedCheckRecordId: string | null;
  status: AnomalyStatus;
  investigatedBy: string | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface FuelAnomalyWithVehicle extends FuelAnomaly {
  registration: string;
  make: string | null;
  model: string | null;
  driverName: string | null;
}

// ============================================================================
// Fuel Analytics Types
// ============================================================================

export interface FleetFuelSummary {
  period: string;
  totalVehicles: number;
  vehiclesWithFuelData: number;

  // Consumption
  totalLitres: number;
  totalCost: number;
  avgLitresPer100km: number;
  bestLitresPer100km: number;
  worstLitresPer100km: number;

  // Cost metrics
  avgCostPerKm: number;
  avgPricePerLitre: number;
  totalKmDriven: number;

  // Trends
  costTrend: 'up' | 'down' | 'flat';
  costTrendValue: number | null;
  efficiencyTrend: 'up' | 'down' | 'flat';
  efficiencyTrendValue: number | null;

  // Anomalies
  totalAnomalies: number;
  unresolvedAnomalies: number;
  criticalAnomalies: number;
}

export interface VehicleFuelStats {
  vehicleId: string;
  registration: string;
  make: string | null;
  model: string | null;
  driverName: string | null;

  // Consumption
  totalLitres: number;
  totalCost: number;
  totalKm: number;
  avgLitresPer100km: number;

  // Efficiency ranking
  efficiencyRank: number;
  efficiencyPercentile: number;

  // Cost analysis
  costPerKm: number;
  monthlyAvgCost: number;

  // Comparison to fleet
  vsFleetAvg: number; // percentage difference

  // Recent activity
  lastFillDate: string | null;
  lastFillLitres: number | null;
  fillCount: number;
}

export interface FuelEfficiencyTrend {
  date: string;
  avgLitresPer100km: number;
  totalLitres: number;
  totalCost: number;
  transactionCount: number;
}

export interface FuelCostBreakdown {
  vehicleId: string;
  registration: string;
  make: string | null;
  model: string | null;
  totalCost: number;
  percentageOfFleet: number;
  costPerKm: number;
  litresPer100km: number;
}

// ============================================================================
// Anomaly Detection Types
// ============================================================================

export interface AnomalyDetectionResult {
  detected: boolean;
  anomalies: DetectedAnomaly[];
  vehiclesChecked: number;
  transactionsAnalyzed: number;
}

export interface DetectedAnomaly {
  vehicleId: string;
  registration: string;
  anomalyType: AnomalyType;
  severity: AnomalySeverity;
  description: string;
  evidence: Record<string, number | string | null>;
  suggestedAction: string;
}

export interface AnomalyThresholds {
  highConsumptionPercentage: number;  // e.g., 30 = 30% above average
  lowConsumptionPercentage: number;   // e.g., 30 = 30% below average
  suddenDropLitres: number;           // e.g., 20 = 20L sudden drop
  priceDeviationPercentage: number;   // e.g., 15 = 15% from market price
  frequentFillDays: number;           // e.g., 3 = fills within 3 days
  frequentFillCount: number;          // e.g., 3 = more than 3 fills
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface GetFuelTransactionsRequest {
  vehicleId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface GetFuelAnomaliesRequest {
  vehicleId?: string;
  status?: AnomalyStatus;
  severity?: AnomalySeverity;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface GetFleetFuelSummaryRequest {
  period?: 'week' | 'month' | 'quarter' | 'year';
}

export interface RunAnomalyDetectionRequest {
  vehicleId?: string; // Optional: run for specific vehicle or all
  lookbackDays?: number;
}

// ============================================================================
// Database Row Types
// ============================================================================

export interface FuelTransactionRow {
  id: string;
  vehicle_id: string;
  transaction_date: string;
  amount_rand: string;
  litres: string;
  price_per_litre: string;
  odometer_reading: number | null;
  km_since_last_fill: number | null;
  litres_per_100km: string | null;
  station_name: string | null;
  station_location: string | null;
  receipt_photo_url: string | null;
  odometer_photo_url: string | null;
  vlm_extracted: boolean;
  vlm_confidence: string | null;
  source: string | null;
  recorded_by: string | null;
  created_at: string;
  // Joined fields
  registration?: string;
  make?: string;
  model?: string;
  driver_name?: string;
}

export interface FuelAnomalyRow {
  id: string;
  vehicle_id: string;
  detected_at: string;
  anomaly_type: string;
  severity: string;
  fuel_level_before: string | null;
  fuel_level_after: string | null;
  expected_consumption: string | null;
  actual_consumption: string | null;
  deviation_percentage: string | null;
  location_lat: string | null;
  location_lon: string | null;
  location_name: string | null;
  related_transaction_id: string | null;
  related_check_record_id: string | null;
  status: string;
  investigated_by: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  // Joined fields
  registration?: string;
  make?: string;
  model?: string;
  driver_name?: string;
}

// ============================================================================
// Row Converters
// ============================================================================

export function rowToFuelTransaction(row: FuelTransactionRow): FuelTransactionWithVehicle {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    transactionDate: row.transaction_date,
    amountRand: parseFloat(row.amount_rand) || 0,
    litres: parseFloat(row.litres) || 0,
    pricePerLitre: parseFloat(row.price_per_litre) || 0,
    odometerReading: row.odometer_reading,
    kmSinceLastFill: row.km_since_last_fill,
    litresPer100km: row.litres_per_100km ? parseFloat(row.litres_per_100km) : null,
    stationName: row.station_name,
    stationLocation: row.station_location,
    receiptPhotoUrl: row.receipt_photo_url,
    odometerPhotoUrl: row.odometer_photo_url,
    vlmExtracted: row.vlm_extracted,
    vlmConfidence: row.vlm_confidence ? parseFloat(row.vlm_confidence) : null,
    source: row.source,
    recordedBy: row.recorded_by,
    createdAt: row.created_at,
    registration: row.registration || '',
    make: row.make || null,
    model: row.model || null,
    driverName: row.driver_name || null,
  };
}

export function rowToFuelAnomaly(row: FuelAnomalyRow): FuelAnomalyWithVehicle {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    detectedAt: row.detected_at,
    anomalyType: row.anomaly_type as AnomalyType,
    severity: row.severity as AnomalySeverity,
    fuelLevelBefore: row.fuel_level_before ? parseFloat(row.fuel_level_before) : null,
    fuelLevelAfter: row.fuel_level_after ? parseFloat(row.fuel_level_after) : null,
    expectedConsumption: row.expected_consumption ? parseFloat(row.expected_consumption) : null,
    actualConsumption: row.actual_consumption ? parseFloat(row.actual_consumption) : null,
    deviationPercentage: row.deviation_percentage ? parseFloat(row.deviation_percentage) : null,
    locationLat: row.location_lat ? parseFloat(row.location_lat) : null,
    locationLon: row.location_lon ? parseFloat(row.location_lon) : null,
    locationName: row.location_name,
    relatedTransactionId: row.related_transaction_id,
    relatedCheckRecordId: row.related_check_record_id,
    status: row.status as AnomalyStatus,
    investigatedBy: row.investigated_by,
    resolutionNotes: row.resolution_notes,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    registration: row.registration || '',
    make: row.make || null,
    model: row.model || null,
    driverName: row.driver_name || null,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

export function getAnomalySeverityColor(severity: AnomalySeverity): string {
  switch (severity) {
    case 'critical': return 'text-red-600 dark:text-red-400';
    case 'high': return 'text-orange-600 dark:text-orange-400';
    case 'medium': return 'text-yellow-600 dark:text-yellow-400';
    case 'low': return 'text-blue-600 dark:text-blue-400';
    default: return 'text-gray-600 dark:text-gray-400';
  }
}

export function getAnomalySeverityBgColor(severity: AnomalySeverity): string {
  switch (severity) {
    case 'critical': return 'bg-red-100 dark:bg-red-900/30';
    case 'high': return 'bg-orange-100 dark:bg-orange-900/30';
    case 'medium': return 'bg-yellow-100 dark:bg-yellow-900/30';
    case 'low': return 'bg-blue-100 dark:bg-blue-900/30';
    default: return 'bg-gray-100 dark:bg-gray-900/30';
  }
}

export function getAnomalyTypeLabel(type: AnomalyType): string {
  switch (type) {
    case 'sudden_drop': return 'Sudden Fuel Drop';
    case 'high_consumption': return 'High Consumption';
    case 'low_consumption': return 'Suspicious Low Consumption';
    case 'impossible_fill': return 'Impossible Fill Amount';
    case 'odometer_mismatch': return 'Odometer Mismatch';
    case 'frequent_fills': return 'Frequent Fill-ups';
    case 'price_anomaly': return 'Price Anomaly';
    default: return type;
  }
}

export function getAnomalyStatusColor(status: AnomalyStatus): string {
  switch (status) {
    case 'detected': return 'text-red-600 dark:text-red-400';
    case 'investigating': return 'text-yellow-600 dark:text-yellow-400';
    case 'resolved': return 'text-green-600 dark:text-green-400';
    case 'dismissed': return 'text-gray-600 dark:text-gray-400';
    default: return 'text-gray-600 dark:text-gray-400';
  }
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatLitres(litres: number): string {
  return `${litres.toFixed(1)} L`;
}

export function formatEfficiency(litresPer100km: number | null): string {
  if (litresPer100km === null) return 'N/A';
  return `${litresPer100km.toFixed(1)} L/100km`;
}
