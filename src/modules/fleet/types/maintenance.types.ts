/**
 * Fleet Maintenance Types
 * Types for predictive maintenance, service intervals, and service history
 */

// ============================================================================
// Service Type Enums
// ============================================================================

export type ServiceType =
  | 'oil_change'
  | 'major_service'
  | 'minor_service'
  | 'brake_pads'
  | 'brake_discs'
  | 'tyres'
  | 'transmission'
  | 'timing_belt'
  | 'air_filter'
  | 'fuel_filter'
  | 'spark_plugs'
  | 'battery'
  | 'coolant_flush'
  | 'wheel_alignment'
  | 'suspension'
  | 'clutch'
  | 'other';

export type ServiceUrgency = 'ok' | 'warning' | 'critical' | 'overdue';

// ============================================================================
// Service Interval Types
// ============================================================================

export interface ServiceInterval {
  id: string;
  vehicleId: string;
  registration?: string;
  serviceType: ServiceType;
  intervalKm: number;
  intervalMonths: number | null;
  lastServiceKm: number | null;
  lastServiceDate: string | null;
  nextServiceKm: number | null;
  nextServiceDate: string | null;
  estimatedCost: number | null;
  providerName: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: string | null;
}

export interface ServiceIntervalWithVehicle extends ServiceInterval {
  registration: string;
  make: string | null;
  model: string | null;
  currentKm: number | null;
  urgency: ServiceUrgency;
  daysUntilDue: number | null;
  kmUntilDue: number | null;
}

// ============================================================================
// Service History Types
// ============================================================================

export interface ServiceHistory {
  id: string;
  vehicleId: string;
  registration?: string;
  serviceIntervalId: string | null;
  documentId?: string | null;
  serviceType: ServiceType;
  serviceDate: string;
  odometerAtService: number | null;

  // Cost breakdown
  laborCost: number | null;
  partsCost: number | null;
  totalCost: number | null;

  // Provider
  providerName: string | null;
  providerLocation?: string | null;
  invoiceNumber: string | null;

  // Details
  description: string | null;
  partsReplaced: string[] | null;
  findings?: string | null;
  recommendations?: string | null;

  // Next service
  nextServiceKm?: number | null;
  nextServiceDate?: string | null;

  // Additional fields
  technicianName?: string | null;
  warrantyClaim?: boolean;

  // Warranty
  warrantyMonths?: number | null;
  warrantyKm?: number | null;
  warrantyExpires?: string | null;

  createdAt: string;
  createdBy?: string | null;
}

export interface ServiceHistoryWithVehicle extends ServiceHistory {
  registration: string;
  make: string | null;
  model: string | null;
}

// ============================================================================
// Upcoming Services Types
// ============================================================================

export interface UpcomingService {
  intervalId: string;
  vehicleId: string;
  registration: string;
  make: string | null;
  model: string | null;
  serviceType: ServiceType;
  intervalKm: number;
  intervalMonths: number | null;
  lastServiceKm: number | null;
  lastServiceDate: string | null;
  nextServiceKm: number | null;
  nextServiceDate: string | null;
  estimatedCost: number | null;
  providerName: string | null;
  currentKm: number | null;
  urgency: ServiceUrgency;
  daysUntilDue: number | null;
  kmUntilDue: number | null;
}

// ============================================================================
// Service Forecast Types
// ============================================================================

export interface ServiceForecast {
  period: '30d' | '60d' | '90d' | '6m' | '12m';
  generatedAt: string;

  // Summary
  totalServicesExpected: number;
  totalEstimatedCost: number;

  // By month
  byMonth: ServiceForecastMonth[];

  // By service type
  byServiceType: Record<ServiceType, {
    count: number;
    estimatedCost: number;
  }>;

  // Individual services
  services: UpcomingService[];
}

export interface ServiceForecastMonth {
  month: string; // e.g., "2026-02"
  serviceCount: number;
  estimatedCost: number;
  services: UpcomingService[];
}

// ============================================================================
// Service Reminder Types
// ============================================================================

export interface ServiceReminder {
  id: string;
  vehicleId: string;
  registration: string;
  serviceType: ServiceType;
  dueDate: string | null;
  dueKm: number | null;
  currentKm: number | null;
  urgency: ServiceUrgency;
  driverName: string | null;
  driverPhone: string | null;
  driverEmail: string | null;
  sentAt: string | null;
  deliveryChannel: 'email' | 'whatsapp' | null;
  deliveryStatus: 'pending' | 'sent' | 'delivered' | 'failed' | null;
}

// ============================================================================
// API Request Types
// ============================================================================

export interface CreateServiceIntervalRequest {
  vehicleId: string;
  serviceType: ServiceType;
  intervalKm: number;
  intervalMonths?: number;
  lastServiceKm?: number;
  lastServiceDate?: string;
  estimatedCost?: number;
  providerName?: string;
  notes?: string;
}

// Service-level input types (used by maintenanceService)
export interface CreateServiceIntervalInput {
  vehicleId: string;
  serviceType: ServiceType;
  intervalKm?: number;
  intervalMonths?: number;
  lastServiceKm?: number;
  lastServiceDate?: string;
  estimatedCost?: number;
  providerName?: string;
  notes?: string;
  isActive?: boolean;
}

export interface UpdateServiceIntervalInput {
  serviceType?: ServiceType;
  intervalKm?: number;
  intervalMonths?: number;
  lastServiceKm?: number;
  lastServiceDate?: string;
  nextServiceKm?: number;
  nextServiceDate?: string;
  estimatedCost?: number;
  providerName?: string;
  notes?: string;
  isActive?: boolean;
}

export interface RecordServiceInput {
  vehicleId: string;
  serviceIntervalId?: string;
  serviceType: ServiceType;
  serviceDate: string;
  odometerAtService?: number;
  laborCost?: number;
  partsCost?: number;
  totalCost?: number;
  providerName?: string;
  invoiceNumber?: string;
  description?: string;
  partsReplaced?: string[];
  technicianName?: string;
  warrantyClaim?: boolean;
}

export interface UpdateServiceIntervalRequest {
  serviceType?: ServiceType;
  intervalKm?: number;
  intervalMonths?: number | null;
  lastServiceKm?: number | null;
  lastServiceDate?: string | null;
  nextServiceKm?: number | null;
  nextServiceDate?: string | null;
  estimatedCost?: number | null;
  providerName?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export interface RecordServiceRequest {
  vehicleId: string;
  serviceIntervalId?: string;
  serviceType: ServiceType;
  serviceDate: string;
  odometerAtService?: number;
  laborCost?: number;
  partsCost?: number;
  totalCost?: number;
  providerName?: string;
  providerLocation?: string;
  invoiceNumber?: string;
  description?: string;
  partsReplaced?: string[];
  findings?: string;
  recommendations?: string;
  warrantyMonths?: number;
  warrantyKm?: number;
}

export interface GetUpcomingServicesRequest {
  days?: number; // Default: 90
  vehicleId?: string;
  urgency?: ServiceUrgency;
}

export interface GetServiceHistoryRequest {
  vehicleId?: string;
  serviceType?: ServiceType;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Database Row Types
// ============================================================================

export interface ServiceIntervalRow {
  id: string;
  vehicle_id: string;
  service_type: string;
  interval_km: number;
  interval_months: number | null;
  last_service_km: number | null;
  last_service_date: string | null;
  next_service_km: number | null;
  next_service_date: string | null;
  estimated_cost: string | null;
  provider_name: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface ServiceHistoryRow {
  id: string;
  vehicle_id: string;
  service_interval_id: string | null;
  document_id: string | null;
  service_type: string;
  service_date: string;
  odometer_at_service: number | null;
  labor_cost: string | null;
  parts_cost: string | null;
  total_cost: string | null;
  provider_name: string | null;
  provider_location: string | null;
  invoice_number: string | null;
  description: string | null;
  parts_replaced: string[] | null;
  findings: string | null;
  recommendations: string | null;
  warranty_months: number | null;
  warranty_km: number | null;
  warranty_expires: string | null;
  created_at: string;
  created_by: string | null;
}

export interface UpcomingServiceRow {
  interval_id: string;
  vehicle_id: string;
  registration: string;
  make: string | null;
  model: string | null;
  service_type: string;
  interval_km: number;
  interval_months: number | null;
  last_service_km: number | null;
  last_service_date: string | null;
  next_service_km: number | null;
  next_service_date: string | null;
  estimated_cost: string | null;
  provider_name: string | null;
  current_km: number | null;
  urgency: string;
  days_until_due: number | null;
  km_until_due: number | null;
}

// ============================================================================
// Row Converters
// ============================================================================

export function rowToServiceInterval(row: ServiceIntervalRow): ServiceInterval {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    serviceType: row.service_type as ServiceType,
    intervalKm: row.interval_km,
    intervalMonths: row.interval_months,
    lastServiceKm: row.last_service_km,
    lastServiceDate: row.last_service_date,
    nextServiceKm: row.next_service_km,
    nextServiceDate: row.next_service_date,
    estimatedCost: row.estimated_cost ? parseFloat(row.estimated_cost) : null,
    providerName: row.provider_name,
    notes: row.notes,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

export function rowToServiceHistory(row: ServiceHistoryRow): ServiceHistory {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    serviceIntervalId: row.service_interval_id,
    documentId: row.document_id,
    serviceType: row.service_type as ServiceType,
    serviceDate: row.service_date,
    odometerAtService: row.odometer_at_service,
    laborCost: row.labor_cost ? parseFloat(row.labor_cost) : null,
    partsCost: row.parts_cost ? parseFloat(row.parts_cost) : null,
    totalCost: row.total_cost ? parseFloat(row.total_cost) : null,
    providerName: row.provider_name,
    providerLocation: row.provider_location,
    invoiceNumber: row.invoice_number,
    description: row.description,
    partsReplaced: row.parts_replaced,
    findings: row.findings,
    recommendations: row.recommendations,
    warrantyMonths: row.warranty_months,
    warrantyKm: row.warranty_km,
    warrantyExpires: row.warranty_expires,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export function rowToUpcomingService(row: UpcomingServiceRow): UpcomingService {
  return {
    intervalId: row.interval_id,
    vehicleId: row.vehicle_id,
    registration: row.registration,
    make: row.make,
    model: row.model,
    serviceType: row.service_type as ServiceType,
    intervalKm: row.interval_km,
    intervalMonths: row.interval_months,
    lastServiceKm: row.last_service_km,
    lastServiceDate: row.last_service_date,
    nextServiceKm: row.next_service_km,
    nextServiceDate: row.next_service_date,
    estimatedCost: row.estimated_cost ? parseFloat(row.estimated_cost) : null,
    providerName: row.provider_name,
    currentKm: row.current_km,
    urgency: row.urgency as ServiceUrgency,
    daysUntilDue: row.days_until_due,
    kmUntilDue: row.km_until_due,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

export function getServiceTypeLabel(type: ServiceType): string {
  const labels: Record<ServiceType, string> = {
    oil_change: 'Oil Change',
    major_service: 'Major Service',
    minor_service: 'Minor Service',
    brake_pads: 'Brake Pads',
    brake_discs: 'Brake Discs',
    tyres: 'Tyres',
    transmission: 'Transmission Service',
    timing_belt: 'Timing Belt',
    air_filter: 'Air Filter',
    fuel_filter: 'Fuel Filter',
    spark_plugs: 'Spark Plugs',
    battery: 'Battery',
    coolant_flush: 'Coolant Flush',
    wheel_alignment: 'Wheel Alignment',
    suspension: 'Suspension',
    clutch: 'Clutch',
    other: 'Other Service',
  };
  return labels[type] || type;
}

export function getUrgencyColor(urgency: ServiceUrgency): string {
  const colors: Record<ServiceUrgency, string> = {
    ok: 'text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/30',
    warning: 'text-yellow-600 bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-900/30',
    critical: 'text-orange-600 bg-orange-100 dark:text-orange-400 dark:bg-orange-900/30',
    overdue: 'text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/30',
  };
  return colors[urgency];
}
