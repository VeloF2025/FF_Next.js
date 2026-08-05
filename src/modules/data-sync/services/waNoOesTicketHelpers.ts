/**
 * Pure helpers + types for waNoOesTicketService (audit rec #5, part B).
 * Split out so the service stays under the 300-line limit and the pure logic is
 * unit-testable without crossing the DB I/O layer.
 *
 * @module data-sync/services/waNoOesTicketHelpers
 */

import {
  TicketSource,
  TicketType,
  TicketPriority,
  TicketStatus,
  type CreateTicketPayload,
} from '@/modules/noc/types/ticket';

/** system@fibreflow.app — the bot account authoring auto-created tickets. */
export const SYSTEM_USER_ID =
  process.env.WA_BRIDGE_SYSTEM_USER_ID ?? '81abd560-48ae-414e-ad31-9d82f1a9ed49';

export const DEFAULT_LIMIT = 1000;
export const MAX_LIMIT = 5000;

/**
 * Statuses that count as "no longer open" for dedup + auto-resolve. 'closed' is
 * retired (migration 364 → 'resolved') and unreachable for new rows; kept as a
 * defensive guard so legacy rows can't slip past the dedup/index predicate.
 */
export const CLOSED_STATUSES = ['resolved', 'closed', 'cancelled', 'verified'];

/** Minimal surface of pg.Pool this service needs — lets tests inject a fake. */
export interface QueryableDb {
  query<R extends Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: R[] }>;
}

export interface WaNoOesCandidate extends Record<string, unknown> {
  drop_number: string;
  project: string;
  /** resolved projects.id (uuid) — always present (INNER JOIN). */
  project_id: string;
  /** project Activations team uuid, or null when the project has none. */
  activations_team_id: string | null;
  wa_submitted_at: string | null;
  wa_serial: string | null;
  wa_serial_source: string | null;
  /** SOW/1Map design position for the DR, as ::text from pg numeric. */
  design_lat?: string | null;
  design_lng?: string | null;
}

export interface WaNoOesScope {
  /** restrict to a single project name (case-insensitive); null = all real projects. */
  projectName?: string | null;
  /** only DRs WA-submitted within this many days; null = no window (backfill). */
  sinceDays?: number | null;
  limit?: number;
}

export interface WaNoOesRunResult {
  scanned: number;
  created: number;
  skippedExisting: number;
  /** of those created, how many had no Activations team (left unassigned). */
  unassigned: number;
  dryRun: boolean;
  preview?: Array<{
    drop_number: string;
    project: string;
    assigned_team_id: string | null;
    title: string;
  }>;
}

export function buildWaNoOesTitle(dropNumber: string, project: string): string {
  return `WA install not activated — ${dropNumber} (${project})`;
}

export function buildWaNoOesDescription(c: WaNoOesCandidate): string {
  const lines = [
    `Drop ${c.drop_number} (project: ${c.project}) was submitted on WhatsApp but has no OES activation record.`,
  ];
  if (c.wa_submitted_at) {
    lines.push(`WA submitted: ${new Date(c.wa_submitted_at).toISOString().slice(0, 10)}`);
  }
  if (c.wa_serial) {
    lines.push(`WA serial (${c.wa_serial_source ?? 'unknown'} source): ${c.wa_serial}`);
  }
  lines.push(
    'Source: three-way recon ledger (recon_class = wa_no_oes). Auto-created by rec #5 part B.'
  );
  return lines.join('\n');
}

/**
 * @param oesGps the activation coordinate when one exists. For wa_no_oes it
 *   usually does not — the class *means* "no OES activation record" — so this is
 *   populated only via the serial fallback, when the ONT activated under a
 *   different DR. That case is exactly the one worth pinning to a real location.
 */
export function buildWaNoOesPayload(
  c: WaNoOesCandidate,
  oesGps?: { latitude: number; longitude: number } | null
): CreateTicketPayload {
  const assigned = c.activations_team_id ?? undefined;
  const designGps =
    c.design_lat != null && c.design_lng != null
      ? { latitude: Number(c.design_lat), longitude: Number(c.design_lng) }
      : null;
  const gps = oesGps ?? designGps ?? undefined;
  return {
    source: TicketSource.WA_NO_OES,
    source_type: 'wa_no_oes',
    ticket_type: TicketType.ACTIVATIONS,
    title: buildWaNoOesTitle(c.drop_number, c.project),
    description: buildWaNoOesDescription(c),
    priority: TicketPriority.NORMAL,
    dr_number: c.drop_number,
    project_id: c.project_id,
    gps_coordinates: gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude) ? gps : undefined,
    created_by: SYSTEM_USER_ID,
    assigned_team_id: assigned,
    status: assigned ? TicketStatus.ASSIGNED : undefined,
  };
}

/** Split candidates into those to create vs skip (already have an open ticket). */
export function partitionForCreation(
  candidates: WaNoOesCandidate[],
  openDrs: Set<string>
): { toCreate: WaNoOesCandidate[]; skippedExisting: number } {
  const toCreate: WaNoOesCandidate[] = [];
  let skippedExisting = 0;
  for (const c of candidates) {
    if (openDrs.has(c.drop_number)) skippedExisting++;
    else toCreate.push(c);
  }
  return { toCreate, skippedExisting };
}

/** Clamp a caller-supplied sinceDays window to a non-negative integer (or null). */
export function clampSinceDays(sinceDays: number | null | undefined): number | null {
  if (sinceDays === null || sinceDays === undefined) return null;
  return Math.max(0, Math.trunc(sinceDays));
}

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  );
}
