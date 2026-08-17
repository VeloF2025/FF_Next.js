/**
 * Activations and procurement — what has been handed to customers, and what has been
 * committed to suppliers.
 *
 * Activations are measured against DROPS, not poles: one drop is one home to connect,
 * and it is a different scope from the pole build. A project can have one imported
 * without the other (Grabouw has 3,793 poles in scope and no drops at all), so each
 * denominator is reported separately and neither substitutes for the other.
 */
import { measure, ratio, throughput, type Measure, type Ratio, type Throughput } from './coverage';
import { baseCaveats, targetCte } from './projectTarget';

export function deliverySectionQuery(project: string): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  return {
    params,
    sql: `
      WITH ${targetCte(project, params)},
      drops_scope AS (
        SELECT count(*)::bigint n FROM drops d WHERE d.project_id = (SELECT id FROM target)
      ),
      -- oes_activations has no project_id; it reaches one through its drop.
      -- activation_date is a DATE, cast so the window matches the timestamptz ones used
      -- elsewhere rather than being offset by the session's UTC offset.
      -- 'Uninstalled' rows are reversals, not activations; counted separately so the
      -- headline figure is connections that stand, and the reversal count is still visible.
      act AS (
        SELECT count(*) FILTER (WHERE COALESCE(a.status, '') <> 'Uninstalled')::bigint AS total,
               count(*) FILTER (WHERE a.status = 'Uninstalled')::bigint AS uninstalled,
               count(*) FILTER (WHERE a.activation_date::timestamptz >= now() - interval '7 days')::bigint  AS last_7d,
               count(*) FILTER (WHERE a.activation_date::timestamptz >= now() - interval '14 days'
                                  AND a.activation_date::timestamptz <  now() - interval '7 days')::bigint  AS prior_7d,
               max(a.activation_date)::text AS newest
        FROM oes_activations a
        JOIN drops d ON d.id = a.drop_id
        WHERE d.project_id = (SELECT id FROM target)
      ),
      act_weekly AS (
        SELECT to_char(date_trunc('week', a.activation_date::timestamptz), 'YYYY-MM-DD') AS week,
               count(*)::bigint AS activations
        FROM oes_activations a
        JOIN drops d ON d.id = a.drop_id
        WHERE d.project_id = (SELECT id FROM target)
          AND a.activation_date::timestamptz >= now() - interval '12 weeks'
        GROUP BY 1 ORDER BY 1 DESC
      ),
      po AS (
        SELECT count(*)::bigint AS n,
               COALESCE(sum(total_amount), 0)::numeric AS value,
               count(*) FILTER (WHERE COALESCE(status, '') = 'pending_approval')::bigint AS pending,
               count(*) FILTER (WHERE cancelled IS TRUE)::bigint AS cancelled
        FROM purchase_orders WHERE project_id = (SELECT id FROM target)
      ),
      po_by_status AS (
        SELECT COALESCE(status, 'unknown') AS status, count(*)::bigint AS n,
               COALESCE(sum(total_amount), 0)::numeric AS value
        FROM purchase_orders WHERE project_id = (SELECT id FROM target)
        GROUP BY 1 ORDER BY 2 DESC
      ),
      -- boq_items.project_id is CHARACTER VARYING while every other table here uses uuid,
      -- so the comparison needs an explicit ::text or Postgres refuses with
      -- "operator does not exist: character varying = uuid".
      boq AS (
        SELECT count(*)::bigint AS n, COALESCE(sum(total_price), 0)::numeric AS value
        FROM boq_items WHERE project_id = (SELECT id::text FROM target)
      )
      SELECT t.project_name, t.status, m.n AS name_matches,
             drops_scope.n AS drops_scope,
             act.total AS activations, act.uninstalled, act.last_7d, act.prior_7d, act.newest AS newest_activation,
             po.n AS po_count, po.value AS po_value, po.pending AS po_pending, po.cancelled AS po_cancelled,
             boq.n AS boq_items, boq.value AS boq_value,
             (SELECT json_agg(json_build_object('week', week, 'activations', activations) ORDER BY week DESC)
                FROM act_weekly) AS weekly,
             (SELECT json_agg(json_build_object('status', status, 'count', n, 'value', value) ORDER BY n DESC)
                FROM po_by_status) AS po_status
      FROM target t, matches m, drops_scope, act, po, boq`,
  };
}

export interface DeliverySectionRow {
  project_name: string;
  status: string | null;
  name_matches: string;
  drops_scope: string;
  activations: string;
  uninstalled: string;
  last_7d: string;
  prior_7d: string;
  newest_activation: string | null;
  po_count: string;
  po_value: string;
  po_pending: string;
  po_cancelled: string;
  boq_items: string;
  boq_value: string;
  weekly: Array<{ week: string; activations: string | number }> | null;
  po_status: Array<{ status: string; count: string | number; value: string | number }> | null;
}

export interface DeliverySection {
  project: string;
  /** Present only when the caller holds `procurement` view. */
  procurementWithheld?: string;
  activations: {
    total: Measure;
    dropsInScope: Measure;
    completion: Ratio;
    throughput: Throughput;
    reversed: Measure;
    newestActivation: string | null;
    weekly: Array<{ week: string; activations: number }>;
  };
  procurement?: {
    purchaseOrders: Measure;
    totalValue: number;
    pendingApproval: Measure;
    cancelled: Measure;
    byStatus: Array<{ status: string; count: number; value: number }>;
    boqItems: Measure;
    boqValue: number;
  };
  caveats: string[];
}

const n = (v: string | number | null | undefined): number => Number(v ?? 0);

/**
 * @param canSeeProcurement the caller's `procurement` view permission, resolved by the
 * route. Purchase-order totals and BOQ values are financial data, and this repo already
 * models that separately: contractor and storeman are explicitly denied `procurement`
 * view, and technician and viewer have no row at all — yet all four hold `projects` view,
 * which is what gates this route. Gating the whole section on `projects` would hand PO
 * commitment values to every one of them, so the block is omitted rather than the
 * request refused: the activation half is legitimately theirs to see.
 */
export function shapeDeliverySection(
  row: DeliverySectionRow,
  canSeeProcurement = true,
): DeliverySection {
  const drops = n(row.drops_scope);
  const activations = n(row.activations);
  const caveats = baseCaveats(row.project_name, n(row.name_matches));

  if (drops > 0 && activations === 0) {
    caveats.push(
      `${drops} drops are in scope but no activations are recorded. That may mean none have ` +
        'been connected, or that the OES activation import does not cover this project — ' +
        'this data cannot tell them apart, so read the 0% with that in mind.',
    );
  }
  if (n(row.uninstalled) > 0) {
    caveats.push(
      `${row.uninstalled} activation${n(row.uninstalled) === 1 ? ' was' : 's were'} later reversed ` +
        '(status "Uninstalled") and excluded from the total.',
    );
  }
  if (drops === 0 && activations === 0) {
    caveats.push(
      'No drops are imported for this project, so activation progress has no denominator. ' +
        'This is a missing import, not evidence that nothing has been activated — build progress is measured against poles and is unaffected.',
    );
  }
  if (canSeeProcurement && n(row.po_pending) > 0) {
    caveats.push(
      `${row.po_pending} purchase order${n(row.po_pending) === 1 ? ' is' : 's are'} awaiting approval.`,
    );
  }

  return {
    project: row.project_name,
    activations: {
      total: measure(activations),
      dropsInScope: measure(drops),
      completion: ratio(activations, drops, row.status),
      throughput: throughput(
        n(row.last_7d),
        n(row.prior_7d),
        drops > 0 ? Math.max(drops - activations, 0) : null,
      ),
      reversed: measure(n(row.uninstalled)),
      newestActivation: row.newest_activation,
      weekly: (row.weekly ?? []).map((w) => ({ week: w.week, activations: n(w.activations) })),
    },
    ...(canSeeProcurement
      ? {}
      : {
          procurementWithheld:
            'Purchase order and BOQ figures are withheld: they need the procurement permission, which this account does not hold. The activation figures above are unaffected.',
        }),
    procurement: canSeeProcurement
      ? {
      purchaseOrders: measure(n(row.po_count)),
      totalValue: n(row.po_value),
      pendingApproval: measure(n(row.po_pending)),
      cancelled: measure(n(row.po_cancelled)),
      byStatus: (row.po_status ?? []).map((s) => ({
        status: s.status,
        count: n(s.count),
        value: n(s.value),
      })),
      boqItems: measure(n(row.boq_items)),
      boqValue: n(row.boq_value),
        }
      : undefined,
    caveats,
  };
}
