/**
 * Return-reason vocabulary for the Phase 3 PWA return flow.
 *
 * Codes MUST match the stock_return_lines.return_reason CHECK constraint
 * (migration 029). Changing labels is fine; changing codes requires a migration.
 */

export type ReturnReason =
  | 'unused'
  | 'job_cancelled'
  | 'wrong_item'
  | 'excess'
  | 'faulty'
  | 'customer_refused';

export interface ReturnReasonOption {
  code: ReturnReason;
  label: string;
}

export const RETURN_REASONS: ReturnReasonOption[] = [
  { code: 'unused',           label: 'Unused — end of job' },
  { code: 'job_cancelled',    label: 'Job cancelled' },
  { code: 'wrong_item',       label: 'Wrong item issued' },
  { code: 'excess',           label: 'Excess — over-issued' },
  { code: 'faulty',           label: 'Faulty / damaged in field' },
  { code: 'customer_refused', label: 'Customer refused install' },
];
