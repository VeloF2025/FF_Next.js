/**
 * Field Stock Control Types
 * PRD-027: Comprehensive type definitions for field stock management
 */

// ============================================================================
// ENUMS
// ============================================================================

export type LocationType =
  | 'warehouse'
  | 'site_store'
  | 'transit'
  | 'technician'
  | 'customer'
  | 'scrap'
  | 'adjustment';

export type ItemCategory =
  | 'ont'
  | 'router'
  | 'mini_ups'
  | 'drop_cable'
  | 'fiber_cable'
  | 'connector'
  | 'consumable'
  | 'tool'
  | 'ppe';

export type TrackingType = 'serial' | 'lot' | 'quantity' | 'drum';

export type SerialStatus =
  | 'available'
  | 'reserved'
  | 'issued'
  | 'installed'
  | 'faulty'
  | 'returned'
  | 'scrapped';

export type SerialCondition =
  | 'new'
  | 'good'
  | 'fair'
  | 'poor'
  | 'damaged'
  | 'non_functional';

export type PickingType = 'issue' | 'receipt' | 'return' | 'transfer' | 'scrap';

export type PickingStatus =
  | 'draft'
  | 'confirmed'
  | 'processing'
  | 'done'
  | 'cancelled';

export type JobType = 'drop' | 'home_install' | 'maintenance';

export type ReturnStatus =
  | 'pending'
  | 'received'
  | 'inspected'
  | 'accepted'
  | 'rejected'
  | 'restocked';

export type ReturnReason =
  | 'unused'
  | 'job_cancelled'
  | 'wrong_item'
  | 'excess'
  | 'faulty'
  | 'customer_refused';

export type Disposition = 'restock' | 'repair' | 'scrap' | 'supplier_return';

export type MovementType =
  | 'receipt'
  | 'issue'
  | 'transfer'
  | 'consumption'
  | 'return'
  | 'adjustment'
  | 'scrap';

export type AccountabilityEventType =
  | 'issue'
  | 'consumption'
  | 'return'
  | 'reconciliation'
  | 'block'
  | 'unblock'
  | 'recovery_added'
  | 'recovery_paid'
  | 'adjustment';

// ============================================================================
// CORE ENTITIES
// ============================================================================

export interface StockLocation {
  id: string;
  parentId?: string;
  code: string;
  name: string;
  locationType: LocationType;
  address?: string;
  coordinates?: { lat: number; lng: number };
  assignedToId?: string;
  assignedToName?: string;
  assignedToPhone?: string;
  projectId?: string;
  isActive: boolean;
  isVirtual: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  // Computed/joined
  children?: StockLocation[];
  stockCount?: number;
}

export interface StockItem {
  id: string;
  itemCode: string;
  name: string;
  description?: string;
  category: ItemCategory;
  trackingType: TrackingType;
  uom: string;
  standardCost?: number;
  currency: string;
  minStockLevel: number;
  maxStockLevel?: number;
  reorderQuantity?: number;
  isActive: boolean;
  isReturnable: boolean;
  createdAt: Date;
  updatedAt: Date;
  // Computed
  totalStock?: number;
  availableStock?: number;
}

export interface StockSerial {
  id: string;
  stockItemId: string;
  serialNumber: string;
  macAddress?: string;
  imei?: string;
  currentLocationId?: string;
  status: SerialStatus;
  installedAtDropId?: string;
  installedAtDropNumber?: string;
  installedAtHomeInstallId?: string;
  installedDate?: Date;
  installedBy?: string;
  receivedDate?: Date;
  receivedReference?: string;
  warrantyEndDate?: Date;
  condition: SerialCondition;
  createdAt: Date;
  updatedAt: Date;
  // Joined flat fields (from query joins)
  itemCode?: string;
  itemName?: string;
  itemCategory?: ItemCategory;
  locationCode?: string;
  locationName?: string;
  // Joined object references (alternative)
  stockItem?: StockItem;
  currentLocation?: StockLocation;
}

export interface StockQuant {
  id: string;
  stockItemId: string;
  locationId: string;
  projectId?: string;
  quantity: number;
  reservedQuantity: number;
  lotNumber?: string;
  unitCost?: number;
  totalValue?: number;
  lastMovementDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  // Joined
  stockItem?: StockItem;
  location?: StockLocation;
}

// ============================================================================
// PICKING ENTITIES
// ============================================================================

export interface StockPicking {
  id: string;
  pickingNumber: string;
  pickingType: PickingType;
  sourceLocationId: string;
  destinationLocationId: string;
  projectId?: string;
  jobReference?: string;
  jobType?: JobType;
  contractorId?: string;
  contractorName?: string;
  teamName?: string;
  technicianId?: string;
  technicianName?: string;
  signatureData?: string;
  signedAt?: Date;
  signedBy?: string;
  status: PickingStatus;
  scheduledDate?: Date;
  effectiveDate?: Date;
  requestedBy?: string;
  approvedBy?: string;
  approvedAt?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  // Joined
  sourceLocation?: StockLocation;
  destinationLocation?: StockLocation;
  lines?: StockPickingLine[];
}

export interface StockPickingLine {
  id: string;
  pickingId: string;
  stockItemId: string;
  plannedQuantity: number;
  actualQuantity?: number;
  serialIds?: string[];
  lotNumber?: string;
  unitCost?: number;
  totalCost?: number;
  status: 'pending' | 'partial' | 'done' | 'cancelled';
  notes?: string;
  createdAt: Date;
  // Joined
  stockItem?: StockItem;
  serials?: StockSerial[];
}

// ============================================================================
// CONSUMPTION ENTITIES
// ============================================================================

export interface StockConsumption {
  id: string;
  jobType: JobType;
  dropId?: string;
  dropNumber?: string;
  homeInstallId?: string;
  pickingId?: string;
  stockItemId: string;
  itemCode: string;
  itemName: string;
  quantity: number;
  uom: string;
  serialId?: string;
  serialNumber?: string;
  consumedById?: string;
  consumedByName?: string;
  consumedFromLocationId?: string;
  consumptionDate: Date;
  gpsLat?: number;
  gpsLng?: number;
  verified: boolean;
  verifiedBy?: string;
  verifiedAt?: Date;
  notes?: string;
  createdAt: Date;
  // Joined
  stockItem?: StockItem;
  serial?: StockSerial;
  consumedFromLocation?: StockLocation;
}

// ============================================================================
// RETURN ENTITIES
// ============================================================================

export interface StockReturn {
  id: string;
  returnNumber: string;
  originalPickingId?: string;
  returnedById?: string;
  returnedByName?: string;
  contractorId?: string;
  contractorName?: string;
  returnToLocationId?: string;
  status: ReturnStatus;
  inspectedBy?: string;
  inspectedAt?: Date;
  inspectionNotes?: string;
  returnDate: Date;
  receivedDate?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  // Joined
  returnToLocation?: StockLocation;
  originalPicking?: StockPicking;
  lines?: StockReturnLine[];
}

export interface StockReturnLine {
  id: string;
  returnId: string;
  stockItemId: string;
  serialId?: string;
  serialNumber?: string;
  quantity: number;
  condition?: SerialCondition;
  returnReason?: ReturnReason;
  disposition?: Disposition;
  status: 'pending' | 'inspected' | 'processed';
  notes?: string;
  createdAt: Date;
  // Joined
  stockItem?: StockItem;
  serial?: StockSerial;
}

// ============================================================================
// ACCOUNTABILITY ENTITIES
// ============================================================================

export interface ContractorStockAccountability {
  id: string;
  contractorId: string;
  contractorName: string;
  totalIssuedCount: number;
  totalIssuedValue: number;
  totalConsumedCount: number;
  totalConsumedValue: number;
  totalReturnedCount: number;
  totalReturnedValue: number;
  unaccountedCount: number;
  unaccountedValue: number;
  currentHeldCount: number;
  currentHeldValue: number;
  isBlocked: boolean;
  blockedReason?: string;
  blockedAt?: Date;
  blockedBy?: string;
  pendingRecoveryAmount: number;
  recoveredAmount: number;
  lastReconciliationDate?: Date;
  lastReconciliationBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockAccountabilityHistory {
  id: string;
  contractorId: string;
  eventType: AccountabilityEventType;
  countChange: number;
  valueChange: number;
  referenceId?: string;
  referenceType?: string;
  referenceNumber?: string;
  notes?: string;
  performedBy?: string;
  performedAt: Date;
  createdAt: Date;
}

// ============================================================================
// MOVEMENT ENTITIES
// ============================================================================

export interface StockMovement {
  id: string;
  pickingId?: string;
  consumptionId?: string;
  stockItemId: string;
  serialId?: string;
  movementType: MovementType;
  fromLocationId?: string;
  toLocationId?: string;
  quantity: number;
  serialNumber?: string;
  unitCost?: number;
  totalCost?: number;
  reference?: string;
  notes?: string;
  performedBy?: string;
  performedAt: Date;
  createdAt: Date;
  // Joined
  stockItem?: StockItem;
  fromLocation?: StockLocation;
  toLocation?: StockLocation;
}

// ============================================================================
// INPUT TYPES (for API requests)
// ============================================================================

export interface CreateLocationInput {
  parentId?: string;
  code: string;
  name: string;
  locationType: LocationType;
  address?: string;
  coordinates?: { lat: number; lng: number };
  assignedToId?: string;
  assignedToName?: string;
  assignedToPhone?: string;
  projectId?: string;
  isVirtual?: boolean;
}

export interface UpdateLocationInput {
  name?: string;
  address?: string;
  coordinates?: { lat: number; lng: number };
  assignedToId?: string;
  assignedToName?: string;
  assignedToPhone?: string;
  projectId?: string;
  isActive?: boolean;
}

export interface CreateStockItemInput {
  itemCode: string;
  name: string;
  description?: string;
  category: ItemCategory;
  trackingType: TrackingType;
  uom?: string;
  standardCost?: number;
  minStockLevel?: number;
  maxStockLevel?: number;
  reorderQuantity?: number;
  isReturnable?: boolean;
}

export interface RegisterSerialInput {
  stockItemId: string;
  serialNumber: string;
  macAddress?: string;
  imei?: string;
  locationId: string;
  receivedDate?: Date;
  receivedReference?: string;
  warrantyEndDate?: Date;
}

export interface CreatePickingInput {
  pickingType: PickingType;
  sourceLocationId: string;
  destinationLocationId: string;
  projectId?: string;
  jobReference?: string;
  jobType?: JobType;
  contractorId?: string;
  contractorName?: string;
  teamName?: string;
  technicianId?: string;
  technicianName?: string;
  scheduledDate?: Date;
  notes?: string;
  lines: CreatePickingLineInput[];
}

export interface CreatePickingLineInput {
  stockItemId: string;
  plannedQuantity: number;
  serialIds?: string[];
  lotNumber?: string;
  notes?: string;
}

export interface SignPickingInput {
  signatureData: string;
  signedBy: string;
}

export interface RecordConsumptionInput {
  jobType: JobType;
  dropId?: string;
  dropNumber?: string;
  homeInstallId?: string;
  stockItemId: string;
  quantity: number;
  serialId?: string;
  serialNumber?: string;
  consumedById?: string;
  consumedByName?: string;
  consumedFromLocationId: string;
  gpsLat?: number;
  gpsLng?: number;
  notes?: string;
}

export interface CreateReturnInput {
  originalPickingId?: string;
  returnedById?: string;
  returnedByName?: string;
  contractorId?: string;
  contractorName?: string;
  returnToLocationId: string;
  notes?: string;
  lines: CreateReturnLineInput[];
}

export interface CreateReturnLineInput {
  stockItemId: string;
  serialId?: string;
  serialNumber?: string;
  quantity?: number;
  condition?: SerialCondition;
  returnReason: ReturnReason;
  notes?: string;
}

export interface InspectReturnLineInput {
  lineId: string;
  condition: SerialCondition;
  disposition: Disposition;
  notes?: string;
}

// ============================================================================
// FILTER TYPES
// ============================================================================

export interface LocationFilters {
  locationType?: LocationType;
  projectId?: string;
  assignedToId?: string;
  isActive?: boolean;
  parentId?: string;
  search?: string;
}

export interface ItemFilters {
  category?: ItemCategory;
  trackingType?: TrackingType;
  isActive?: boolean;
  search?: string;
}

export interface SerialFilters {
  stockItemId?: string;
  status?: SerialStatus;
  locationId?: string;
  installedAtDropNumber?: string;
  search?: string;
}

export interface PickingFilters {
  pickingType?: PickingType;
  status?: PickingStatus;
  contractorId?: string;
  technicianId?: string;
  projectId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface ConsumptionFilters {
  jobType?: JobType;
  dropNumber?: string;
  technicianId?: string;
  verified?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
}

// ============================================================================
// DASHBOARD TYPES
// ============================================================================

export interface FieldStockDashboard {
  totalLocations: number;
  totalItems: number;
  totalSerials: number;
  serialsByStatus: Record<SerialStatus, number>;
  stockByLocation: {
    locationId: string;
    locationName: string;
    locationType: LocationType;
    itemCount: number;
    totalValue: number;
  }[];
  recentMovements: StockMovement[];
  lowStockAlerts: {
    item: StockItem;
    currentStock: number;
    minLevel: number;
  }[];
  pendingPickings: number;
  unverifiedConsumptions: number;
}

export interface TechnicianStockSummary {
  technicianId: string;
  technicianName: string;
  locationId: string;
  issuedCount: number;
  consumedCount: number;
  returnedCount: number;
  currentHoldingCount: number;
  currentHoldingValue: number;
  serialsHeld: StockSerial[];
}

export interface ContractorAccountabilitySummary {
  contractor: ContractorStockAccountability;
  recentActivity: StockAccountabilityHistory[];
  serialsUnaccounted: StockSerial[];
  pendingReturns: StockReturn[];
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface FieldStockApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ============================================================================
// DTO TYPES (Data Transfer Objects for hooks)
// ============================================================================

export interface CreatePickingDTO {
  pickingType: PickingType;
  sourceLocationId: string;
  destinationLocationId: string;
  projectId?: string;
  jobReference?: string;
  jobType?: JobType;
  contractorId?: string;
  contractorName?: string;
  teamName?: string;
  technicianId?: string;
  technicianName?: string;
  scheduledDate?: string;
  notes?: string;
  lines: {
    stockItemId: string;
    plannedQuantity: number;
    serialIds?: string[];
    notes?: string;
  }[];
}

export interface CreateReturnDTO {
  originalPickingId?: string;
  returnedById?: string;
  returnedByName?: string;
  returnToLocationId: string;
  notes?: string;
  lines: {
    stockItemId: string;
    serialId?: string;
    serialNumber?: string;
    quantity?: number;
    condition?: SerialCondition;
    returnReason?: ReturnReason;
    notes?: string;
  }[];
}

export interface ReturnLineDisposition {
  condition?: SerialCondition;
  disposition?: Disposition;
  notes?: string;
}
