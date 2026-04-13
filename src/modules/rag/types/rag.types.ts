/**
 * RAG (Red/Amber/Green) Status Types
 * Modular contractor health scoring system
 * Created: Nov 3, 2025
 */

// ==================== ENUMS ====================

/**
 * RAG Status - Traffic light system
 */
export type RagStatus = 'green' | 'amber' | 'red';

/**
 * RAG Categories - What we're scoring
 */
export type RagCategory =
  | 'overall'      // Combined health score
  | 'financial'    // Payment history, credit
  | 'compliance'   // Documents, licenses, insurance
  | 'performance'  // Project completion, quality
  | 'safety';      // Safety incidents, protocols

// ==================== CORE INTERFACES ====================

/**
 * Complete RAG status for a contractor
 */
export interface ContractorRagStatus {
  contractorId: string;
  companyName?: string; // Optional contractor name for display

  // RAG Scores (one for each category)
  overall: RagStatus;
  financial: RagStatus;
  compliance: RagStatus;
  performance: RagStatus;
  safety: RagStatus;

  // When calculated
  calculatedAt: Date;

  // Details for each category
  details: {
    financial: RagCategoryDetails;
    compliance: RagCategoryDetails;
    performance: RagCategoryDetails;
    safety: RagCategoryDetails;
  };
}

/**
 * Detailed information for each RAG category
 */
export interface RagCategoryDetails {
  status: RagStatus;
  score: number;           // Numeric score (0-100)
  issues: string[];        // List of issues found
  warnings: string[];      // List of warnings
  recommendations: string[]; // What to do
  lastChecked: Date;
}

// ==================== SCORING INPUT DATA ====================

/**
 * Data needed to calculate Financial RAG
 */
export interface FinancialData {
  overduePayments: number;      // Days overdue
  latePaymentCount: number;     // Count of late payments
  creditRating?: string;        // Optional credit rating
  outstandingInvoices: number;  // Amount owed
}

/**
 * Data needed to calculate Compliance RAG
 */
export interface ComplianceData {
  expiredDocuments: number;       // Count of expired docs
  expiringIn30Days: number;       // Count expiring soon
  totalRequiredDocuments: number; // Total docs needed
  missingDocuments: string[];     // List of missing doc types
}

/**
 * Data needed to calculate Performance RAG
 */
export interface PerformanceData {
  totalProjects: number;
  completedOnTime: number;
  delayedProjects: number;
  failedProjects: number;
  averageQualityScore: number;    // 0-5 scale
  onTimeCompletionRate: number;   // Percentage
}

/**
 * Data needed to calculate Safety RAG
 */
export interface SafetyData {
  incidentsLast12Months: number;
  majorIncidents: number;          // Serious injuries/violations
  minorIncidents: number;
  safetyTrainingCurrent: boolean;
  lastSafetyAuditDate?: Date;
}

/**
 * Complete data package for RAG calculation
 */
export interface RagCalculationInput {
  contractorId: string;
  financial: FinancialData;
  compliance: ComplianceData;
  performance: PerformanceData;
  safety: SafetyData;
}

// ==================== HISTORY ====================

/**
 * RAG status change history (stored in DB)
 */
export interface RagHistoryEntry {
  id: number;
  contractorId: string;
  category: RagCategory;
  oldStatus: RagStatus | null;  // null for first entry
  newStatus: RagStatus;
  changeReason: string;
  changedBy?: string;
  changedAt: Date;
}

// ==================== DASHBOARD ====================

/**
 * Summary stats for RAG dashboard
 */
export interface RagSummaryStats {
  total: number;
  red: number;
  amber: number;
  green: number;
  byCategory: {
    financial: { red: number; amber: number; green: number };
    compliance: { red: number; amber: number; green: number };
    performance: { red: number; amber: number; green: number };
    safety: { red: number; amber: number; green: number };
  };
}

/**
 * Contractor with RAG status (for dashboard list)
 */
export interface ContractorWithRag {
  id: string;
  companyName: string;
  registrationNumber: string;
  status: string;
  ragStatus: ContractorRagStatus;
}

/**
 * Filter options for RAG dashboard
 */
export interface RagDashboardFilter {
  overallStatus?: RagStatus[];     // Filter by overall RAG
  category?: RagCategory;           // Focus on specific category
  categoryStatus?: RagStatus[];     // Filter by category status
  searchTerm?: string;              // Search company name
  province?: string[];              // Filter by location
}

// ==================== CONSTANTS ====================

/**
 * RAG status display configuration
 */
export const RAG_STATUS_CONFIG = {
  green: {
    label: 'Green',
    color: 'green',
    bgColor: 'bg-green-100',
    textColor: 'text-green-800',
    borderColor: 'border-green-300',
    emoji: '🟢',
    description: 'Good standing - no issues',
  },
  amber: {
    label: 'Amber',
    color: 'amber',
    bgColor: 'bg-yellow-100',
    textColor: 'text-yellow-800',
    borderColor: 'border-yellow-300',
    emoji: '🟡',
    description: 'Needs monitoring - minor issues',
  },
  red: {
    label: 'Red',
    color: 'red',
    bgColor: 'bg-red-100',
    textColor: 'text-red-800',
    borderColor: 'border-red-300',
    emoji: '🔴',
    description: 'Urgent attention required',
  },
} as const;

/**
 * RAG category display configuration
 */
export const RAG_CATEGORY_CONFIG = {
  overall: {
    label: 'Overall Health',
    icon: '📊',
    description: 'Combined health score across all categories',
  },
  financial: {
    label: 'Financial',
    icon: '💰',
    description: 'Payment history and credit standing',
  },
  compliance: {
    label: 'Compliance',
    icon: '📋',
    description: 'Documents, licenses, and certifications',
  },
  performance: {
    label: 'Performance',
    icon: '⭐',
    description: 'Project completion and quality',
  },
  safety: {
    label: 'Safety',
    icon: '🦺',
    description: 'Safety record and incidents',
  },
} as const;

// ==================== VALIDATION ====================

/**
 * Check if a value is a valid RAG status
 */
export function isValidRagStatus(value: unknown): value is RagStatus {
  return value === 'green' || value === 'amber' || value === 'red';
}

/**
 * Check if a value is a valid RAG category
 */
export function isValidRagCategory(value: unknown): value is RagCategory {
  return ['overall', 'financial', 'compliance', 'performance', 'safety'].includes(value as string);
}
