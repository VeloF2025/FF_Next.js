/**
 * Document Report Service (Backend)
 *
 * Aggregates contractor document data from database and generates reports
 */

import { neon } from '@/lib/db-neon';
import type {
  ContractorDocumentReport,
  DocumentInfo,
  TeamMemberDocuments,
  ContractorBasicInfo,
  DocumentVerificationStatus,
  AllContractorsSummary,
  ContractorSummaryItem,
} from '../types/documentReport.types';
import { ALL_COMPANY_DOCUMENTS } from '../types/documentCategories';
import {
  calculateDaysUntilExpiry,
  calculateUrgencyLevel,
  calculateDisplayStatus,
} from '../utils/documentStatusRules';
import { calculateContractorSummary, calculateOverallStatistics } from '../utils/completenessCalculator';
import { generateDocumentAlerts, hasUrgentAlerts } from '../utils/alertGenerator';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Fetch contractor basic info
 */
async function fetchContractorInfo(contractorId: string): Promise<ContractorBasicInfo | null> {
  const result = await sql`
    SELECT id, company_name, status
    FROM contractors
    WHERE id = ${contractorId}
    LIMIT 1
  `;

  if (result.length === 0) return null;

  return {
    id: result[0]!.id,
    name: result[0]!.company_name,
    status: result[0]!.status,
  };
}

/**
 * Fetch company documents from database
 */
async function fetchCompanyDocuments(contractorId: string): Promise<Map<string, any>> {
  const result = await sql`
    SELECT
      id,
      document_type,
      file_name,
      file_url,
      verification_status,
      expiry_date,
      created_at,
      verified_at,
      verified_by,
      rejection_reason
    FROM contractor_documents
    WHERE contractor_id = ${contractorId}
    ORDER BY created_at DESC
  `;

  // Create a map of document type -> document data (most recent)
  const docMap = new Map<string, any>();

  result.forEach((row) => {
    const docType = row.document_type;
    // Only store if we haven't seen this type yet (most recent due to ORDER BY)
    if (!docMap.has(docType)) {
      docMap.set(docType, row);
    }
  });

  return docMap;
}

/**
 * Fetch team members and their ID documents
 * NOTE: Team member documents table doesn't exist yet, so all IDs will show as "missing"
 */
async function fetchTeamMemberDocuments(contractorId: string): Promise<TeamMemberDocuments[]> {
  // Get all team members from team_members table
  const members = await sql`
    SELECT id, first_name, last_name, role
    FROM team_members
    WHERE contractor_id = ${contractorId}
      AND is_active = true
    ORDER BY first_name, last_name ASC
  `;

  if (members.length === 0) return [];

  // Build team member documents array
  // Note: contractor_team_documents table doesn't exist yet, so all documents are "missing"
  const teamDocuments: TeamMemberDocuments[] = members.map((member) => {
    const fullName = `${member.first_name} ${member.last_name}`;

    // All team member IDs are marked as missing since storage doesn't exist yet
    return {
      teamMemberId: member.id,
      memberName: fullName,
      role: member.role || 'Team Member',
      idDocument: undefined, // No documents stored yet
      displayStatus: 'missing', // All marked as missing
    };
  });

  return teamDocuments;
}

/**
 * Build complete document info from database row
 */
function buildDocumentInfo(docType: string, dbRow: any | null): DocumentInfo {
  if (!dbRow) {
    // Document doesn't exist in database - it's missing
    return {
      id: `missing-${docType}`,
      type: docType as any,
      category: 'company',
      verificationStatus: 'missing',
      urgencyLevel: 'ok',
      displayStatus: 'missing',
    };
  }

  const verificationStatus: DocumentVerificationStatus = dbRow.verification_status || 'pending';
  const expiryDate = dbRow.expiry_date;
  const daysUntilExpiry = calculateDaysUntilExpiry(expiryDate);
  const urgencyLevel = calculateUrgencyLevel(expiryDate, docType);
  const displayStatus = calculateDisplayStatus(verificationStatus, urgencyLevel);

  return {
    id: dbRow.id,
    type: docType as any,
    category: 'company',
    verificationStatus,
    fileName: dbRow.file_name,
    fileUrl: dbRow.file_url,
    expiryDate,
    daysUntilExpiry: daysUntilExpiry || undefined,
    urgencyLevel,
    displayStatus,
    uploadedAt: dbRow.created_at,
    verifiedAt: dbRow.verified_at,
    verifiedBy: dbRow.verified_by,
    rejectionReason: dbRow.rejection_reason,
  };
}

/**
 * Generate full document report for a contractor
 */
export async function generateContractorDocumentReport(
  contractorId: string
): Promise<ContractorDocumentReport | null> {
  // Fetch contractor info
  const contractor = await fetchContractorInfo(contractorId);
  if (!contractor) return null;

  // Fetch company documents
  const companyDocsMap = await fetchCompanyDocuments(contractorId);

  // Build DocumentInfo array for all required company documents
  const companyDocuments: DocumentInfo[] = ALL_COMPANY_DOCUMENTS.map((docType) => {
    const dbRow = companyDocsMap.get(docType) || null;
    return buildDocumentInfo(docType, dbRow);
  });

  // Fetch team member documents
  const teamDocuments = await fetchTeamMemberDocuments(contractorId);

  // Calculate summary
  const summary = calculateContractorSummary(companyDocuments, teamDocuments);

  // Generate alerts
  const alerts = generateDocumentAlerts(companyDocuments, teamDocuments, summary);

  return {
    contractor,
    summary,
    companyDocuments,
    teamDocuments,
    alerts,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Generate summary for all contractors
 */
export async function generateAllContractorsSummary(): Promise<AllContractorsSummary> {
  // Fetch all approved contractors (not suspended or pending)
  const contractors = await sql`
    SELECT id, company_name, status
    FROM contractors
    WHERE status = 'approved'
    ORDER BY company_name ASC
  `;

  const contractorSummaries: ContractorSummaryItem[] = [];

  // Generate summary for each contractor
  for (const contractor of contractors) {
    const report = await generateContractorDocumentReport(contractor.id);

    if (!report) continue;

    const hasAlerts = hasUrgentAlerts(report.alerts);

    contractorSummaries.push({
      id: contractor.id,
      name: contractor.company_name,
      completionPercentage: report.summary.completionPercentage,
      totalDocuments: report.summary.totalDocuments,
      verified: report.summary.verified,
      missing: report.summary.missing,
      expired: report.summary.expired,
      pending: report.summary.pending,
      expiring: report.summary.expiring,
      hasAlerts,
      alertCount: report.alerts.length,
    });
  }

  // Calculate overall statistics
  const overallStats = calculateOverallStatistics(contractorSummaries);

  return {
    contractors: contractorSummaries,
    overallStats,
  };
}
