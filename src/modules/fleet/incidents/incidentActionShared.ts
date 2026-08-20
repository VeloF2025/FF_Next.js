/**
 * Shared per-phase bookkeeping for the Fleet incident action runner
 * (`actionRunner.ts`) and its morning-summary phase
 * (`incidentSummaryPhase.ts`): error totals, bounded error messages, and
 * minute-of-day helpers used by more than one phase.
 */
import { log } from '@/lib/logger';
import type { NotifyResult } from '@/modules/notifications/types';

export const MODULE = 'FleetIncidentActionRunner';
const MAX_ERROR_ENTRIES = 20;
const MAX_ERROR_SUMMARY_LENGTH = 2000;

export interface Totals { notifAccepted: number; notifFailed: number; errorCount: number; errorMessages: string[] }
export interface EscalationTotals extends Totals { escalated: number }
export interface SummaryTotals extends Totals { sent: number }

function sanitizedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}
export function boundedErrorSummary(entries: string[]): string | null {
  if (entries.length === 0) return null;
  const bounded = entries.slice(0, MAX_ERROR_ENTRIES).join('; ');
  return bounded.length > MAX_ERROR_SUMMARY_LENGTH ? `${bounded.slice(0, MAX_ERROR_SUMMARY_LENGTH)}…` : bounded;
}
export function addMinutesIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}
export function sastMinutesOfDay(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  return Number(parts.find((p) => p.type === 'hour')?.value ?? '0') * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
}
/** Shared per-phase failure bookkeeping: count it, keep a bounded message, and log with context — never throws, never aborts the phase's loop. */
export function recordPhaseError(totals: Totals, logLabel: string, context: { incidentId?: string; runId?: string; projectId?: string | null }, error: unknown): void {
  const message = sanitizedMessage(error);
  const subject = context.incidentId ?? context.runId ?? null;
  totals.errorCount += 1;
  totals.errorMessages.push(subject ? `${subject}: ${message}` : message);
  log.error(logLabel, { ...context, error: message }, MODULE);
}
export function applyDelivery(totals: Totals, delivery: NotifyResult): void {
  totals.notifAccepted += delivery.delivered; totals.notifFailed += delivery.failed;
}
