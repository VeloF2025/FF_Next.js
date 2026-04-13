import { Timestamp } from 'firebase/firestore';

// Status History tracking for poles
export interface StatusHistoryEntry {
  status: string; // The status value (e.g., "Pole Permission: Approved")
  changedAt: Timestamp | Date; // When the status changed
  changedBy?: string; // User ID who made the change
  changedByName?: string; // Display name of the user
  source?: string; // Source of the change (e.g., "OneMap Import", "Manual Update")
  importBatchId?: string; // If from import, which batch
  notes?: string; // Any additional notes about the change
  previousStatus?: string; // What the status was before this change
}

export enum PoleType {
  WOODEN = 'wooden',
  CONCRETE = 'concrete',
  STEEL = 'steel',
  FIBERGLASS = 'fiberglass'
}

export enum PoleStatus {
  NOT_STARTED = 'not_started',
  PLANNED = 'planned',
  APPROVED = 'approved',
  IN_PROGRESS = 'in_progress',
  INSTALLED = 'installed',
  TESTED = 'tested',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled'
}

export enum InstallationPhase {
  PERMISSION = 'permission',
  EXCAVATION = 'excavation',
  INSTALLATION = 'installation',
  BACKFILL = 'backfill',
  TESTING = 'testing',
  COMPLETION = 'completion'
}

export interface PoleTracker {
  // Core Identity
  id?: string;
  vfPoleId: string; // Auto-generated: "LAW.P.A001"
  projectId: string;
  projectCode: string; // From project
  projectName?: string; // For display

  // Pole Identification (Data Integrity Rules: SPEC-DATA-001)
  poleNumber: string; // Physical pole number - MUST be globally unique
  alternativePoleId?: string; // Alternative ID if pole number not found
  groupNumber?: string; // If poles are grouped

  // Drop Relationship Management (Max 12 drops per pole)
  connectedDrops?: string[]; // Array of drop numbers connected to this pole
  dropCount?: number; // Calculated field: connectedDrops.length
  maxCapacity: number; // Always 12 (physical cable limit)

  // Status Management (From OneMap and other sources)
  status?: string; // Current status (e.g., "Pole Permission: Approved", "Construction: In Progress")
  statusHistory?: StatusHistoryEntry[]; // Complete history of status changes

  // Network Details
  pon?: string; // PON (Passive Optical Network) identifier
  zone?: string; // Zone/Area designation
  distributionFeeder?: string; // Distribution or Feeder type

  // Installation Details
  dateInstalled: Timestamp | Date;
  location: string; // GPS coordinates or address
  poleType: PoleType;
  contractorId: string;
  contractorName?: string; // For display
  workingTeam: string;
  ratePaid?: number; // Rate paid to contractor for this pole installation

  // Location & Mapping
  gpsCoordinates?: {
    latitude: number;
    longitude: number;
    accuracy?: number; // GPS accuracy in meters
  };
  address?: string; // Physical address
  municipality?: string;
  ward?: string;

  // Installation Quality & Validation
  installationPhotos?: PolePhoto[]; // Photos of installation process
  qualityChecks?: QualityCheck[]; // Validation checklist
  installationPhase: InstallationPhase;
  estimatedCompletionDate?: Date;
  actualCompletionDate?: Date;

  // Technical Specifications
  poleHeight?: number; // Meters
  groundLevel?: number; // Meters above sea level
  soilType?: string;
  weatherConditions?: string; // During installation
  installationDepth?: number; // Meters
  
  // Offline Support
  offlineMode?: boolean; // True if created offline
  syncStatus?: 'synced' | 'pending' | 'failed';
  lastSyncAttempt?: Date;

  // Audit Fields
  createdAt: Timestamp | Date;
  createdBy: string; // User ID
  createdByName?: string; // User display name
  updatedAt: Timestamp | Date;
  updatedBy: string;
  updatedByName?: string;
  
  // Import Tracking
  importBatchId?: string; // If created from bulk import
  importSource?: string; // "OneMap", "Excel", "Manual"
  originalData?: Record<string, unknown>; // Original import data for reference
}

export interface PolePhoto {
  id: string;
  url: string;
  type: PhotoType;
  description?: string;
  timestamp: Date;
  gpsLocation?: {
    latitude: number;
    longitude: number;
  };
  metadata?: {
    deviceInfo?: string;
    fileSize?: number;
    resolution?: string;
  };
}

export enum PhotoType {
  BEFORE = 'before', // Site before installation
  FRONT = 'front', // Front view of pole
  SIDE = 'side', // Side angle view
  DEPTH = 'depth', // Installation depth
  CONCRETE = 'concrete', // Base/foundation
  COMPACTION = 'compaction', // Ground compaction
  COMPLETED = 'completed', // Final installation
  DAMAGE = 'damage', // Any damage or issues
  OTHER = 'other' // Other documentation photos
}

export interface QualityCheck {
  id: string;
  checkType: QualityCheckType;
  status: 'pass' | 'fail' | 'pending';
  notes?: string;
  checkedBy: string;
  checkedByName?: string;
  checkedAt: Date;
  photos?: string[]; // Photo URLs as evidence
}

export enum QualityCheckType {
  DEPTH_COMPLIANCE = 'depth_compliance',
  CONCRETE_QUALITY = 'concrete_quality',
  ALIGNMENT = 'alignment',
  GROUNDING = 'grounding',
  CABLE_ROUTING = 'cable_routing',
  SAFETY_COMPLIANCE = 'safety_compliance',
  PERMITS = 'permits',
  CLEANUP = 'cleanup'
}

// Search and filtering types
export interface PoleSearchFilters {
  projectId?: string;
  contractorId?: string;
  status?: PoleStatus;
  poleType?: PoleType;
  installationPhase?: InstallationPhase;
  dateRange?: {
    start: Date;
    end: Date;
  };
  location?: {
    municipality?: string;
    ward?: string;
    zone?: string;
  };
  syncStatus?: 'synced' | 'pending' | 'failed';
  hasPhotos?: boolean;
  qualityStatus?: 'pass' | 'fail' | 'pending';
}

export interface PoleListItem {
  id: string;
  vfPoleId: string;
  poleNumber: string;
  projectName: string;
  contractorName?: string;
  status: string;
  installationPhase: InstallationPhase;
  location: string;
  dateInstalled: Date;
  photoCount: number;
  syncStatus: 'synced' | 'pending' | 'failed';
  hasIssues: boolean;
}

// API response types
export interface PoleTrackerResponse {
  poles: PoleTracker[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface PoleValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

// Form types
export interface PoleFormData {
  // Basic Information
  poleNumber: string;
  projectId: string;
  contractorId: string;
  poleType: PoleType;
  
  // Location
  address: string;
  gpsCoordinates?: {
    latitude: number;
    longitude: number;
  };
  municipality?: string;
  ward?: string;
  zone?: string;
  
  // Technical Details
  poleHeight?: number;
  installationDepth?: number;
  soilType?: string;
  
  // Network
  pon?: string;
  distributionFeeder?: string;
  
  // Scheduling
  estimatedCompletionDate?: Date;
  workingTeam: string;
  ratePaid?: number;
  
  // Notes
  notes?: string;
}

// Statistics and analytics types
export interface PoleStatistics {
  total: number;
  byStatus: Record<PoleStatus, number>;
  byPhase: Record<InstallationPhase, number>;
  byContractor: Record<string, number>;
  byProject: Record<string, number>;
  avgInstallationTime: number; // days
  completionRate: number; // percentage
  qualityPassRate: number; // percentage
}

export interface PoleProgressMetrics {
  planned: number;
  inProgress: number;
  completed: number;
  failed: number;
  totalDrops: number;
  avgDropsPerPole: number;
  capacityUtilization: number; // percentage of max capacity used
}

// Legacy types for backward compatibility
export type PoleData = PoleTracker;

export interface DropData {
  id?: string;
  dropNumber: string;
  poleNumber: string;
  customerName: string;
  address: string;
  installationType: 'aerial' | 'underground' | 'hybrid';
  status: 'pending' | 'in_progress' | 'completed';
  cableLength?: number;
  photos?: string[];
  notes?: string;
}