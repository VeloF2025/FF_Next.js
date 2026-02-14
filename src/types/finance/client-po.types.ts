/**
 * Client Purchase Order Types
 * Income/contract side - NOT supplier POs (which are in procurement)
 */

export type ClientPOStatus = 'draft' | 'active' | 'completed' | 'cancelled';

export interface ClientPurchaseOrder {
  id: string;
  poNumber: string;
  reference?: string;
  projectId: string;
  clientId: string;

  // Contracted scope
  contractedDrops: number;
  pricePerDrop: number;
  totalValue: number;

  // Progress tracking
  dropsAssigned: number;
  dropsActivated: number;
  amountInvoiced: number;
  amountPaid: number;

  // Spare tracking
  sparesAllocated: number;
  sparesUsed: number;

  // Status
  status: ClientPOStatus;

  // Dates
  poDate: string;
  validFrom?: string;
  validTo?: string;

  // Tax
  taxRate: number;
  taxInclusive: boolean;

  // Notes
  description?: string;
  terms?: string;

  // Audit
  createdBy: string;
  createdAt: string;
  updatedAt: string;

  // Source document (PDF import)
  sourceDocumentUrl?: string;
  sourceDocumentName?: string;
  vlmExtractionData?: Record<string, unknown>;
  vlmConfidenceScore?: number;

  // Joined data (optional)
  clientName?: string;
  projectName?: string;
}

export interface ClientPOCreateInput {
  poNumber: string;
  reference?: string;
  clientId?: string; // Defaults to project's client
  contractedDrops: number;
  pricePerDrop: number;
  poDate: string;
  validFrom?: string;
  validTo?: string;
  taxRate?: number;
  taxInclusive?: boolean;
  description?: string;
  terms?: string;
  // Source document (for PDF import)
  sourceDocumentUrl?: string;
  sourceDocumentName?: string;
  vlmExtractionData?: Record<string, unknown>;
  vlmConfidenceScore?: number;
}

export interface ClientPOUpdateInput {
  poNumber?: string;
  reference?: string;
  contractedDrops?: number;
  pricePerDrop?: number;
  poDate?: string;
  validFrom?: string;
  validTo?: string;
  taxRate?: number;
  taxInclusive?: boolean;
  description?: string;
  terms?: string;
  status?: ClientPOStatus;
}

export interface ClientPOProgress {
  assignedPercent: number;
  activatedPercent: number;
  invoicedPercent: number;
  paidPercent: number;
  remainingDrops: number;
  remainingValue: number;
}

export interface ClientPOSummary {
  totalContractValue: number;
  totalDropsContracted: number;
  totalDropsActivated: number;
  totalInvoiced: number;
  totalPaid: number;
  totalOutstanding: number;
  activationProgress: number;
  invoicingProgress: number;
  poCount: number;
  activePoCount: number;
  // Spare tracking (derived: total deployed - PO contracted = spares)
  totalProjectDrops: number;
  totalSpares: number;
  sparesUsed: number;
  sparesAvailable: number;
}

export interface AssignDropsInput {
  dropIds: string[];
}

export interface AssignDropsResult {
  assigned: number;
  alreadyAssigned: number;
  errors: string[];
}

// Spare Drop Tracking
export type SpareUsageReason =
  | 'failed_drop'
  | 'damaged_ont'
  | 'customer_relocation'
  | 'signal_quality'
  | 'construction_issue'
  | 'other';

export interface SpareUsageLogEntry {
  id: string;
  spareDropNumber: string;
  replacedDropNumber?: string;
  reason: SpareUsageReason;
  notes?: string;
  recordedBy: string;
  recordedAt: string;
}

export interface SpareSummary {
  sparesAllocated: number;
  sparesUsed: number;
  sparesAvailable: number;
}
