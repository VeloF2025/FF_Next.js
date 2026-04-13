/**
 * Three-Way Alignment Service
 *
 * Compares tickets across Excel (master/source of truth), FibreFlow, and QContact.
 * Excel sheet columns: Status (2), FT Ref (3), DR Number (4)
 *
 * Features:
 * - Compare using FT Ref and/or DR Number
 * - Identify tickets in all three systems
 * - Find tickets missing from FibreFlow or QContact
 * - Detect status misalignments
 * - Generate suggested actions for synchronization
 */

import { query, queryOne } from '../utils/db';
import { createLogger } from '@/lib/logger';
import { FiberTimeQContactClient } from './fibertimeQContactClient';

const logger = createLogger('maintenance:alignment');

/**
 * Excel ticket row from parsed sheet
 */
export interface ExcelTicketRow {
  row_number: number;
  status: string;
  ft_ref: string;
  dr_number: string;
  issue?: string;
  date_captured?: string;
  date_resolved?: string;
  area?: string;
}

/**
 * FibreFlow ticket summary
 */
export interface FibreFlowTicketSummary {
  id: string;
  ticket_uid: string;
  external_id: string | null;
  title: string;
  status: string;
  dr_number: string | null;
  created_at: string;
}

/**
 * QContact ticket summary
 */
export interface QContactTicketSummary {
  case_id: string;
  ft_ref: string;
  status: string;
  subject: string;
}

/**
 * Status mismatch details
 */
export interface StatusMismatch {
  ft_ref: string;
  dr_number?: string;
  excel_status: string;
  fibreflow_status?: string;
  qcontact_status?: string;
  fibreflow_ticket_uid?: string;
}

/**
 * Alignment action
 */
export interface AlignmentAction {
  action: 'create_in_fibreflow' | 'update_status' | 'link_tickets' | 'archive';
  ft_ref: string;
  dr_number?: string;
  source: 'excel' | 'fibreflow' | 'qcontact';
  details: string;
  priority: 'high' | 'medium' | 'low';
}

/**
 * Three-way alignment report
 */
export interface ThreeWayAlignmentReport {
  generated_at: string;
  sources: {
    excel: { total: number; resolved: number; in_progress: number };
    fibreflow: { total: number; from_qcontact: number };
    qcontact: { total: number; available: boolean };
  };
  summary: {
    in_all_three: number;
    in_excel_and_fibreflow: number;
    in_excel_and_qcontact: number;
    in_excel_only: number;
    in_fibreflow_only: number;
    status_mismatches: number;
  };
  details: {
    in_excel_only: ExcelTicketRow[];
    in_fibreflow_only: FibreFlowTicketSummary[];
    status_mismatches: StatusMismatch[];
  };
  suggested_actions: AlignmentAction[];
}

/**
 * Parse Excel ticket data from raw rows
 */
export function parseExcelTickets(rows: unknown[][], headers?: string[]): ExcelTicketRow[] {
  const tickets: ExcelTicketRow[] = [];

  // Default column indices (0-based)
  let statusIdx = 2;
  let ftRefIdx = 3;
  let drNumberIdx = 4;
  let issueIdx = 5;
  let areaIdx = 1;

  // If headers provided, find correct indices
  if (headers) {
    headers.forEach((h, idx) => {
      const header = (h || '').toString().toLowerCase();
      if (header.includes('status') && !header.includes('ont')) statusIdx = idx;
      if (header.includes('ft ref') || header === 'ft_ref') ftRefIdx = idx;
      if (header.includes('dr number') || header.includes('dr_number')) drNumberIdx = idx;
      if (header.includes('issue')) issueIdx = idx;
      if (header.includes('area')) areaIdx = idx;
    });
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as (string | number | null | undefined)[];
    if (!row) continue;

    const ftRef = (row[ftRefIdx] ?? '').toString().trim();

    // Skip rows without FT reference
    if (!ftRef || !ftRef.startsWith('FT')) continue;

    tickets.push({
      row_number: i + 2, // +2 for 1-based and header row
      status: (row[statusIdx] ?? '').toString().trim(),
      ft_ref: ftRef,
      dr_number: (row[drNumberIdx] ?? '').toString().trim(),
      issue: (row[issueIdx] ?? '').toString().trim(),
      area: (row[areaIdx] ?? '').toString().trim(),
    });
  }

  return tickets;
}

/**
 * Get FibreFlow tickets for alignment
 */
async function getFibreFlowTickets(): Promise<FibreFlowTicketSummary[]> {
  const tickets = await query<FibreFlowTicketSummary>(
    `SELECT
       id, ticket_uid, external_id, title, status, dr_number, created_at
     FROM maintenance_tickets
     WHERE status != 'cancelled'
     ORDER BY created_at DESC`
  );

  return tickets;
}

/**
 * Get QContact tickets (from FiberTime API)
 */
async function getQContactTickets(): Promise<QContactTicketSummary[]> {
  try {
    const client = new FiberTimeQContactClient();
    const cases = await client.listAllCases(500); // Get up to 500 cases

    return (cases as unknown[]).map((c) => {
      const cas = c as { id?: number; fields?: { status?: string; subject?: string } };
      return {
        case_id: cas.id?.toString() || '',
        ft_ref: `FT${cas.id}`,
        status: cas.fields?.status || 'Unknown',
        subject: cas.fields?.subject || '',
      };
    });
  } catch (error) {
    logger.warn('Could not fetch QContact tickets', { error });
    return [];
  }
}

/**
 * Extract FT reference from FibreFlow ticket title
 */
function extractFtRefFromTitle(title: string | null): string | null {
  if (!title) return null;
  const match = title.match(/FT\d+/);
  return match ? match[0] : null;
}

/**
 * Generate three-way alignment report
 *
 * @param excelTickets - Parsed Excel ticket data
 * @returns Alignment report with summaries and suggested actions
 */
export async function generateThreeWayAlignmentReport(
  excelTickets: ExcelTicketRow[]
): Promise<ThreeWayAlignmentReport> {
  logger.info('Generating 3-way alignment report', { excelCount: excelTickets.length });

  const generatedAt = new Date().toISOString();

  // Get FibreFlow tickets
  const ffTickets = await getFibreFlowTickets();

  // Get QContact tickets
  const qcTickets = await getQContactTickets();
  const qcAvailable = qcTickets.length > 0;

  // Build lookup maps
  const ffByFtRef = new Map<string, FibreFlowTicketSummary>();
  const ffByDrNumber = new Map<string, FibreFlowTicketSummary>();

  ffTickets.forEach((t) => {
    // Extract FT ref from title
    const ftRef = extractFtRefFromTitle(t.title) || t.external_id;
    if (ftRef) ffByFtRef.set(ftRef, t);
    if (t.dr_number) ffByDrNumber.set(t.dr_number, t);
  });

  const qcByFtRef = new Map<string, QContactTicketSummary>();
  qcTickets.forEach((t) => {
    qcByFtRef.set(t.ft_ref, t);
  });

  const excelFtRefs = new Set(excelTickets.map((t) => t.ft_ref));

  // Initialize counters
  let inAllThree = 0;
  let inExcelAndFibreflow = 0;
  let inExcelAndQcontact = 0;
  let inExcelOnly = 0;
  let statusMismatches = 0;

  const inExcelOnlyList: ExcelTicketRow[] = [];
  const statusMismatchList: StatusMismatch[] = [];
  const suggestedActions: AlignmentAction[] = [];

  // Process each Excel ticket
  for (const excelTicket of excelTickets) {
    const ffTicket =
      ffByFtRef.get(excelTicket.ft_ref) ||
      (excelTicket.dr_number ? ffByDrNumber.get(excelTicket.dr_number) : null);
    const qcTicket = qcByFtRef.get(excelTicket.ft_ref);

    const inFibreFlow = !!ffTicket;
    const inQContact = !!qcTicket;

    if (inFibreFlow && inQContact) {
      inAllThree++;
    } else if (inFibreFlow && !inQContact) {
      inExcelAndFibreflow++;
    } else if (!inFibreFlow && inQContact) {
      inExcelAndQcontact++;

      // Suggest creating in FibreFlow
      suggestedActions.push({
        action: 'create_in_fibreflow',
        ft_ref: excelTicket.ft_ref,
        dr_number: excelTicket.dr_number,
        source: 'excel',
        details: `Ticket exists in Excel and QContact but not FibreFlow`,
        priority: 'high',
      });
    } else {
      inExcelOnly++;
      inExcelOnlyList.push(excelTicket);

      // Suggest creating in FibreFlow
      suggestedActions.push({
        action: 'create_in_fibreflow',
        ft_ref: excelTicket.ft_ref,
        dr_number: excelTicket.dr_number,
        source: 'excel',
        details: `Ticket only exists in Excel sheet`,
        priority: 'medium',
      });
    }

    // Check for status mismatches (Excel is source of truth)
    if (inFibreFlow) {
      const excelResolved =
        excelTicket.status.toLowerCase() === 'resolved' ||
        excelTicket.status.toLowerCase() === 'closed';
      const ffResolved =
        ffTicket.status === 'closed' || ffTicket.status === 'resolved';

      if (excelResolved && !ffResolved) {
        statusMismatches++;
        statusMismatchList.push({
          ft_ref: excelTicket.ft_ref,
          dr_number: excelTicket.dr_number,
          excel_status: excelTicket.status,
          fibreflow_status: ffTicket.status,
          qcontact_status: qcTicket?.status,
          fibreflow_ticket_uid: ffTicket.ticket_uid,
        });

        suggestedActions.push({
          action: 'update_status',
          ft_ref: excelTicket.ft_ref,
          dr_number: excelTicket.dr_number,
          source: 'excel',
          details: `Update FibreFlow status from '${ffTicket.status}' to 'resolved' (Excel shows '${excelTicket.status}')`,
          priority: 'high',
        });
      }
    }
  }

  // Find tickets only in FibreFlow (not in Excel)
  const inFibreflowOnly: FibreFlowTicketSummary[] = [];
  for (const ffTicket of ffTickets) {
    const ftRef = extractFtRefFromTitle(ffTicket.title) || ffTicket.external_id;
    if (ftRef && !excelFtRefs.has(ftRef)) {
      // Check if DR number matches
      const drMatch =
        ffTicket.dr_number &&
        excelTickets.some((e) => e.dr_number === ffTicket.dr_number);
      if (!drMatch) {
        inFibreflowOnly.push(ffTicket);
      }
    }
  }

  // Build report
  const report: ThreeWayAlignmentReport = {
    generated_at: generatedAt,
    sources: {
      excel: {
        total: excelTickets.length,
        resolved: excelTickets.filter(
          (t) =>
            t.status.toLowerCase() === 'resolved' ||
            t.status.toLowerCase() === 'closed'
        ).length,
        in_progress: excelTickets.filter(
          (t) => t.status.toLowerCase() === 'in progress'
        ).length,
      },
      fibreflow: {
        total: ffTickets.length,
        from_qcontact: ffTickets.filter((t) => t.external_id).length,
      },
      qcontact: {
        total: qcTickets.length,
        available: qcAvailable,
      },
    },
    summary: {
      in_all_three: inAllThree,
      in_excel_and_fibreflow: inExcelAndFibreflow,
      in_excel_and_qcontact: inExcelAndQcontact,
      in_excel_only: inExcelOnly,
      in_fibreflow_only: inFibreflowOnly.length,
      status_mismatches: statusMismatches,
    },
    details: {
      in_excel_only: inExcelOnlyList,
      in_fibreflow_only: inFibreflowOnly,
      status_mismatches: statusMismatchList,
    },
    suggested_actions: suggestedActions,
  };

  logger.info('Alignment report generated', {
    summary: report.summary,
    actionsCount: suggestedActions.length,
  });

  return report;
}

/**
 * Apply alignment actions (update statuses, create tickets, etc.)
 */
export async function applyAlignmentActions(
  actions: AlignmentAction[],
  options: { dryRun?: boolean } = {}
): Promise<{
  success: boolean;
  applied: number;
  skipped: number;
  errors: Array<{ action: AlignmentAction; error: string }>;
}> {
  const { dryRun = false } = options;

  logger.info('Applying alignment actions', {
    count: actions.length,
    dryRun,
  });

  const result = {
    success: true,
    applied: 0,
    skipped: 0,
    errors: [] as Array<{ action: AlignmentAction; error: string }>,
  };

  for (const action of actions) {
    try {
      if (action.action === 'update_status') {
        // Find ticket by FT ref or DR number
        const ticket = await queryOne<{ id: string; ticket_uid: string }>(
          `SELECT id, ticket_uid FROM maintenance_tickets
           WHERE (title LIKE $1 OR external_id = $2 OR dr_number = $3)
           LIMIT 1`,
          [`%${action.ft_ref}%`, action.ft_ref, action.dr_number || '']
        );

        if (ticket && !dryRun) {
          await queryOne(
            `UPDATE maintenance_tickets
             SET status = 'resolved', updated_at = NOW()
             WHERE id = $1`,
            [ticket.id]
          );
          logger.info(`Updated status for ${ticket.ticket_uid} to resolved`);
        }

        result.applied++;
      } else if (action.action === 'create_in_fibreflow') {
        // Skip for now - would need more ticket details
        result.skipped++;
        logger.debug(`Skipped create action for ${action.ft_ref} - not implemented`);
      } else {
        result.skipped++;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push({ action, error: errorMsg });
      logger.error(`Failed to apply action for ${action.ft_ref}`, { error });
    }
  }

  result.success = result.errors.length === 0;

  logger.info('Alignment actions completed', {
    applied: result.applied,
    skipped: result.skipped,
    errors: result.errors.length,
  });

  return result;
}
