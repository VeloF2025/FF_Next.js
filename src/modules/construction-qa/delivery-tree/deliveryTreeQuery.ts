/**
 * Delivery-tree read query.
 *
 * Single source of truth for the SQL behind
 * `GET /api/construction-qa/delivery-tree`. Lives in the module (not the route)
 * so it can be exercised against a real Postgres fixture without pulling the
 * Next auth middleware into the test.
 */

import type { QueryResult, QueryResultRow } from 'pg';
import { buildDeliveryTree } from './buildDeliveryTree';
import type { DeliveryTreeQueryRow, DeliveryTreeResult } from './types';

/** Anything that can run a parameterised query: a pg Pool or PoolClient. */
export interface DeliveryTreeQueryable {
  query<R extends QueryResultRow>(text: string, params: unknown[]): Promise<QueryResult<R>>;
}

export interface DeliveryTreeOptions {
  /** Restrict to one project; null returns every project. */
  projectId: string | null;
  /** Keep only PONs whose port submission has been recorded. */
  opticalSubmittedOnly: boolean;
}

/** Raw shape as node-postgres returns it: timestamps as Date, ints as number. */
export interface DeliveryTreeRawRow {
  project_id: string;
  project_name: string;
  zone_no: number;
  pon_no: number;
  poles_total: number;
  poles_planted: number;
  activation_total: number;
  activation_complete: number;
  port_submitted_at: Date | string | null;
  has_active_fac: boolean | null;
  has_active_cac: boolean | null;
}

// Zone certificates are per project + zone, so they are aggregated once and
// joined rather than correlated per PON row.
const BASE_QUERY = `
  SELECT
    t.project_id,
    p.project_name,
    t.zone_no,
    t.pon_no,
    COALESCE(t.poles_total, 0)::int AS poles_total,
    COALESCE(t.poles_planted, 0)::int AS poles_planted,
    COALESCE(t.activation_total, 0)::int AS activation_total,
    COALESCE(t.activation_complete, 0)::int AS activation_complete,
    d.port_submitted_at,
    COALESCE(z.has_active_fac, FALSE) AS has_active_fac,
    COALESCE(z.has_active_cac, FALSE) AS has_active_cac
  FROM pon_stage_tracking t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN pon_delivery_state d ON d.pon_stage_id = t.id
  LEFT JOIN (
    SELECT
      project_id,
      zone_no,
      bool_or(document_type = 'fac' AND superseded_at IS NULL) AS has_active_fac,
      bool_or(document_type = 'cac' AND superseded_at IS NULL) AS has_active_cac
    FROM zone_delivery_documents
    GROUP BY project_id, zone_no
  ) z ON z.project_id = t.project_id AND z.zone_no = t.zone_no
`;

const ORDER_BY = ' ORDER BY p.project_name, t.zone_no, t.pon_no';

const iso = (value: Date | string | null): string | null => {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

/** Map one raw row onto the pure builder's input shape. */
export function toQueryRow(row: DeliveryTreeRawRow): DeliveryTreeQueryRow {
  return {
    project_id: row.project_id,
    project_name: row.project_name,
    zone_no: Number(row.zone_no),
    pon_no: Number(row.pon_no),
    poles_total: Number(row.poles_total),
    poles_planted: Number(row.poles_planted),
    activation_total: Number(row.activation_total),
    activation_complete: Number(row.activation_complete),
    port_submitted_at: iso(row.port_submitted_at),
    hasActiveFac: row.has_active_fac === true,
    hasActiveCac: row.has_active_cac === true,
  };
}

/**
 * Build the SQL text and bind parameters for the given filters.
 *
 * Explicit query branches — conditional tagged-template SQL fragments are
 * broken in this codebase, so each filter combination builds its own text.
 */
export function buildDeliveryTreeQuery(
  options: DeliveryTreeOptions,
): { text: string; params: string[] } {
  const conditions: string[] = [];
  const params: string[] = [];

  if (options.projectId !== null) {
    params.push(options.projectId);
    conditions.push(`t.project_id = $${params.length}::uuid`);
  }
  if (options.opticalSubmittedOnly) {
    conditions.push('d.port_submitted_at IS NOT NULL');
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  return { text: `${BASE_QUERY}${where}${ORDER_BY}`, params };
}

/** Run the delivery-tree query and assemble the Project → Zone → PON tree. */
export async function fetchDeliveryTree(
  db: DeliveryTreeQueryable,
  options: DeliveryTreeOptions,
): Promise<DeliveryTreeResult> {
  const { text, params } = buildDeliveryTreeQuery(options);
  const result = await db.query<DeliveryTreeRawRow>(text, params);
  return buildDeliveryTree(result.rows.map(toQueryRow));
}
