/**
 * RAG Calculation Service
 * Calculates RAG status for contractors based on various data sources
 */

import type {
  ContractorRagStatus,
  RagCalculationInput,
  FinancialData,
  ComplianceData,
  PerformanceData,
  SafetyData,
} from '../types/rag.types';
import {
  calculateFinancialRag,
  calculateComplianceRag,
  calculatePerformanceRag,
  calculateSafetyRag,
  calculateOverallRag,
} from '../utils/ragRules';

/**
 * Calculate complete RAG status for a contractor
 */
export function calculateContractorRag(input: RagCalculationInput, companyName?: string): ContractorRagStatus {
  // Calculate each category independently
  const financial = calculateFinancialRag(input.financial);
  const compliance = calculateComplianceRag(input.compliance);
  const performance = calculatePerformanceRag(input.performance);
  const safety = calculateSafetyRag(input.safety);

  // Calculate overall based on category statuses
  const overall = calculateOverallRag(
    financial.status,
    compliance.status,
    performance.status,
    safety.status
  );

  return {
    contractorId: input.contractorId,
    companyName,
    overall,
    financial: financial.status,
    compliance: compliance.status,
    performance: performance.status,
    safety: safety.status,
    calculatedAt: new Date(),
    details: {
      financial,
      compliance,
      performance,
      safety,
    },
  };
}

/**
 * Gather data needed for RAG calculation from database row
 */
interface RagDbRow {
  credit_rating?: string;
  expired_documents_count?: number;
  expiring_soon_count?: number;
  total_required_documents?: number;
  missing_documents?: string[];
  total_projects?: number;
  completed_projects?: number;
  cancelled_projects?: number;
  quality_score?: number;
  timeliness_score?: number;
  safety_incidents_12m?: number;
  last_safety_audit_date?: string;
  id: string;
  company_name?: string;
}

export function prepareRagInputFromDbRow(row: RagDbRow): RagCalculationInput {
  // Extract financial data
  const financial: FinancialData = {
    overduePayments: 0, // TODO: Calculate from actual payment data
    latePaymentCount: 0, // TODO: Count from payment history
    creditRating: row.credit_rating,
    outstandingInvoices: 0, // TODO: Sum from invoices
  };

  // Extract compliance data from contractor_documents
  const compliance: ComplianceData = {
    expiredDocuments: row.expired_documents_count || 0,
    expiringIn30Days: row.expiring_soon_count || 0,
    totalRequiredDocuments: row.total_required_documents || 10,
    missingDocuments: row.missing_documents || [],
  };

  // Extract performance data from projects
  const performance: PerformanceData = {
    totalProjects: row.total_projects || 0,
    completedOnTime: row.completed_projects || 0,
    delayedProjects: row.cancelled_projects || 0,
    failedProjects: 0, // TODO: Track failed projects
    averageQualityScore: row.quality_score || 0,
    onTimeCompletionRate: row.timeliness_score || 0, // Use timeliness_score as percentage
  };

  // Extract safety data
  const safety: SafetyData = {
    incidentsLast12Months: row.safety_incidents_12m || 0,
    majorIncidents: 0, // TODO: Track major vs minor incidents
    minorIncidents: row.safety_incidents_12m || 0,
    safetyTrainingCurrent: true, // TODO: Check certification dates
    lastSafetyAuditDate: row.last_safety_audit_date ? new Date(row.last_safety_audit_date) : undefined,
  };

  return {
    contractorId: row.id,
    financial,
    compliance,
    performance,
    safety,
  };
}

/**
 * Calculate RAG status for multiple contractors efficiently
 */
export function calculateBulkRag(contractors: RagDbRow[]): ContractorRagStatus[] {
  return contractors.map(contractor => {
    const input = prepareRagInputFromDbRow(contractor);
    return calculateContractorRag(input, contractor.company_name);
  });
}

/**
 * Compare two RAG statuses to detect changes
 */
export function hasRagStatusChanged(
  oldStatus: ContractorRagStatus | null,
  newStatus: ContractorRagStatus
): boolean {
  if (!oldStatus) return true;

  return (
    oldStatus.overall !== newStatus.overall ||
    oldStatus.financial !== newStatus.financial ||
    oldStatus.compliance !== newStatus.compliance ||
    oldStatus.performance !== newStatus.performance ||
    oldStatus.safety !== newStatus.safety
  );
}

/**
 * Get list of categories that changed between two statuses
 */
export function getRagChanges(
  oldStatus: ContractorRagStatus | null,
  newStatus: ContractorRagStatus
): string[] {
  if (!oldStatus) return ['initial_calculation'];

  const changes: string[] = [];

  if (oldStatus.overall !== newStatus.overall) changes.push('overall');
  if (oldStatus.financial !== newStatus.financial) changes.push('financial');
  if (oldStatus.compliance !== newStatus.compliance) changes.push('compliance');
  if (oldStatus.performance !== newStatus.performance) changes.push('performance');
  if (oldStatus.safety !== newStatus.safety) changes.push('safety');

  return changes;
}
