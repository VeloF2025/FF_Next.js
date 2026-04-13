/**
 * QContact Alignment Service
 * 🟢 WORKING: Compares tickets between QContact and FibreFlow
 *
 * Features:
 * - Generates alignment report comparing both systems
 * - Identifies status misalignments
 * - Identifies missing tickets in either system
 * - Provides suggested actions for alignment
 */

import { createLogger } from '@/lib/logger';
import { query } from '../utils/db';
import {
  createFiberTimeQContactClient,
  FiberTimeCase,
} from './fibertimeQContactClient';
import {
  getStatusAlignment,
} from '../constants/qcontactStatusMapping';
import { TicketStatus } from '../types/ticket';

const logger = createLogger('qcontactAlignmentService');

// ============================================================================
// Types
// ============================================================================

export interface QContactTicketSummary {
  qcontact_id: string;
  qcontact_ref: string;
  qcontact_status: string;
  created_at: string;
  label: string;
}

export interface FibreFlowTicketSummary {
  id: string;
  ticket_uid: string;
  external_id: string;
  status: TicketStatus;
  title: string;
  created_at: string;
}

export interface AlignmentMismatch {
  qcontact_id: string;
  qcontact_ref: string;
  fibreflow_id: string;
  fibreflow_ticket_uid: string;
  qcontact_status: string;
  fibreflow_status: TicketStatus;
  expected_status: TicketStatus;
  suggested_action: 'none' | 'update' | 'review';
  reason: string;
}

export interface AlignmentReport {
  generated_at: string;
  summary: {
    qcontact_total: number;
    fibreflow_total: number;
    aligned: number;
    misaligned: number;
    missing_in_fibreflow: number;
    missing_in_qcontact: number;
  };
  misalignments: AlignmentMismatch[];
  missing_in_fibreflow: QContactTicketSummary[];
  missing_in_qcontact: FibreFlowTicketSummary[];
}

export interface AlignmentFix {
  fibreflow_id: string;
  new_status: TicketStatus;
  reason: string;
}

export interface ApplyResult {
  success: boolean;
  applied: number;
  failed: number;
  errors: { fibreflow_id: string; error: string }[];
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Generate alignment report comparing QContact and FibreFlow tickets
 */
export async function generateAlignmentReport(): Promise<AlignmentReport> {
  logger.info('Generating QContact alignment report');

  const client = createFiberTimeQContactClient();

  // Step 1: Fetch all tickets from QContact
  const qcontactTickets = await fetchAllQContactTickets(client);
  logger.info(`Fetched ${qcontactTickets.length} tickets from QContact`);

  // Step 2: Fetch all QContact-sourced tickets from FibreFlow
  const fibreflowTickets = await fetchAllFibreFlowQContactTickets();
  logger.info(`Fetched ${fibreflowTickets.length} tickets from FibreFlow`);

  // Step 3: Create lookup maps
  const qcontactMap = new Map<string, QContactTicketSummary>();
  for (const ticket of qcontactTickets) {
    qcontactMap.set(ticket.qcontact_id, ticket);
  }

  const fibreflowMap = new Map<string, FibreFlowTicketSummary>();
  for (const ticket of fibreflowTickets) {
    if (ticket.external_id) {
      fibreflowMap.set(ticket.external_id, ticket);
    }
  }

  // Step 4: Compare and categorize
  const misalignments: AlignmentMismatch[] = [];
  const missingInFibreflow: QContactTicketSummary[] = [];
  const missingInQContact: FibreFlowTicketSummary[] = [];
  let alignedCount = 0;

  // Check each QContact ticket
  for (const [qcontactId, qcTicket] of qcontactMap) {
    const ffTicket = fibreflowMap.get(qcontactId);

    if (!ffTicket) {
      // Ticket exists in QContact but not in FibreFlow
      missingInFibreflow.push(qcTicket);
      continue;
    }

    // Compare statuses
    const alignment = getStatusAlignment(qcTicket.qcontact_status, ffTicket.status);

    if (alignment.isAligned) {
      alignedCount++;
    } else {
      misalignments.push({
        qcontact_id: qcontactId,
        qcontact_ref: qcTicket.qcontact_ref,
        fibreflow_id: ffTicket.id,
        fibreflow_ticket_uid: ffTicket.ticket_uid,
        qcontact_status: qcTicket.qcontact_status,
        fibreflow_status: ffTicket.status,
        expected_status: alignment.expectedFibreFlowStatus,
        suggested_action: alignment.suggestedAction,
        reason: alignment.reason,
      });
    }
  }

  // Check for FibreFlow tickets not in QContact
  for (const [externalId, ffTicket] of fibreflowMap) {
    if (!qcontactMap.has(externalId)) {
      missingInQContact.push(ffTicket);
    }
  }

  const report: AlignmentReport = {
    generated_at: new Date().toISOString(),
    summary: {
      qcontact_total: qcontactTickets.length,
      fibreflow_total: fibreflowTickets.length,
      aligned: alignedCount,
      misaligned: misalignments.length,
      missing_in_fibreflow: missingInFibreflow.length,
      missing_in_qcontact: missingInQContact.length,
    },
    misalignments,
    missing_in_fibreflow: missingInFibreflow,
    missing_in_qcontact: missingInQContact,
  };

  logger.info('Alignment report generated', {
    aligned: alignedCount,
    misaligned: misalignments.length,
    missingInFibreflow: missingInFibreflow.length,
    missingInQContact: missingInQContact.length,
  });

  return report;
}

/**
 * Apply alignment fixes to FibreFlow tickets
 */
export async function applyAlignmentFixes(
  fixes: AlignmentFix[],
  dryRun: boolean = false
): Promise<ApplyResult> {
  logger.info(`Applying ${fixes.length} alignment fixes (dryRun: ${dryRun})`);

  const result: ApplyResult = {
    success: true,
    applied: 0,
    failed: 0,
    errors: [],
  };

  for (const fix of fixes) {
    try {
      if (!dryRun) {
        await query(
          `UPDATE maintenance_tickets
           SET status = $1, updated_at = NOW()
           WHERE id = $2`,
          [fix.new_status, fix.fibreflow_id]
        );
      }
      result.applied++;
      logger.debug(`Applied fix to ${fix.fibreflow_id}: ${fix.new_status}`);
    } catch (error) {
      result.failed++;
      result.errors.push({
        fibreflow_id: fix.fibreflow_id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      logger.error(`Failed to apply fix to ${fix.fibreflow_id}`, { error });
    }
  }

  result.success = result.failed === 0;

  logger.info('Alignment fixes applied', {
    applied: result.applied,
    failed: result.failed,
    dryRun,
  });

  return result;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Fetch all tickets from QContact with their statuses
 * Note: We need to fetch details for each case to get the status
 */
async function fetchAllQContactTickets(
  client: ReturnType<typeof createFiberTimeQContactClient>
): Promise<QContactTicketSummary[]> {
  const tickets: QContactTicketSummary[] = [];

  // First, fetch all case IDs from list view
  let page = 1;
  const pageSize = 50;
  let hasMore = true;
  const allCases: FiberTimeCase[] = [];

  while (hasMore) {
    const response = await client.listCases({ page, pageSize });
    const cases = response.results || [];
    allCases.push(...cases);

    if (cases.length < pageSize) {
      hasMore = false;
    } else {
      page++;
      if (page > 100) {
        logger.warn('Reached page limit of 100');
        hasMore = false;
      }
    }
  }

  // Fetch details in batches to get status
  const batchSize = 10;

  for (let i = 0; i < allCases.length; i += batchSize) {
    const batch = allCases.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map(async (ftCase) => {
        const detail = await client.getCase(ftCase.id);
        return { ftCase, detail };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.detail) {
        const { ftCase, detail } = result.value;
        const status = (detail.fields?.status as string) || 'unknown';

        tickets.push({
          qcontact_id: String(ftCase.id),
          qcontact_ref: extractRef(ftCase.label),
          qcontact_status: status,
          created_at: ftCase.created_at,
          label: ftCase.label,
        });
      }
    }

    // Small delay between batches
    if (i + batchSize < allCases.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return tickets;
}

/**
 * Fetch all FibreFlow tickets that came from QContact
 */
async function fetchAllFibreFlowQContactTickets(): Promise<FibreFlowTicketSummary[]> {
  const result = await query<{
    id: string;
    ticket_uid: string;
    external_id: string;
    status: string;
    title: string;
    created_at: string;
  }>(
    `SELECT id, ticket_uid, external_id, status, title, created_at
     FROM maintenance_tickets
     WHERE source = 'qcontact' AND external_id IS NOT NULL
     ORDER BY created_at DESC`
  );

  return result.map((row) => ({
    id: row.id,
    ticket_uid: row.ticket_uid,
    external_id: row.external_id,
    status: row.status as TicketStatus,
    title: row.title,
    created_at: row.created_at,
  }));
}

/**
 * Extract reference (FT number) from label
 */
function extractRef(label: string): string {
  const match = label.match(/FT\d+/);
  return match ? match[0] : label.trim();
}
