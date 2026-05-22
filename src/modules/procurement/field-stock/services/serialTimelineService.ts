/**
 * Serial-register lifecycle timeline — read-only query that combines real
 * stock_serial_events rows with pseudo entries derived from columns on
 * stock_serials. PR-0 probe found 66 events across 36,264 serials (99.82%
 * have no events), so the pseudo branches are the main signal until the
 * event stream has been backfilled.
 *
 * Sibling to serialService.ts (CRUD/lifecycle) and serialSearchService.ts
 * (master search). This file owns the per-serial timeline concern.
 *
 * Schema dependencies confirmed against prod 2026-05-22:
 *   stock_serials.previous_status        varchar(50) NULL
 *   stock_serials.status_changed_at      timestamptz NULL
 *   stock_serials.received_date          date NULL
 *   stock_serials.installed_date         timestamptz NULL
 *   stock_serials.activated_at_olt_id    text NULL
 *   stock_serial_events.actor_user_id / actor_staff_id  uuid NULL
 *   users.first_name, users.last_name
 *   staff.first_name, staff.last_name
 */
import { pool } from '@/lib/db-pool';
import type { TimelineEntry } from '@/types/field-stock';

export interface SerialDetail {
  id: string;
  serialNumber: string;
  macAddress: string | null;
  category: string | null;
  itemName: string | null;
  status: string;
  currentLocationName: string | null;
  allocatedProjectName: string | null;
  installedAtDropNumber: string | null;
  installedDate: string | null;
  receivedDate: string | null;
  activatedAtOltId: string | null;
}

export interface TimelineResult {
  serial: SerialDetail;
  entries: TimelineEntry[];
  hasRealEvents: boolean;
}

interface SerialRow {
  id: string;
  serial_number: string;
  mac_address: string | null;
  category: string | null;
  item_name: string | null;
  status: string;
  location_name: string | null;
  project_name: string | null;
  drop_number: string | null;
  installed_date: Date | string | null;
  received_date: Date | string | null;
  activated_at_olt_id: string | null;
  previous_status: string | null;
  status_changed_at: Date | string | null;
}

interface EventRow {
  id: string;
  event_type: string;
  from_state: string | null;
  to_state: string | null;
  occurred_at: Date | string;
  source_table: string | null;
  source_id: string | null;
  payload: Record<string, unknown> | null;
  actor_name: string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function getSerialTimeline(serialNumber: string): Promise<TimelineResult | null> {
  const serialRes = await pool.query<SerialRow>(
    `
    SELECT
      ss.id,
      ss.serial_number,
      ss.mac_address,
      si.category,
      si.name AS item_name,
      ss.status,
      sl.name AS location_name,
      p.name AS project_name,
      ss.installed_at_drop_number AS drop_number,
      ss.installed_date,
      ss.received_date,
      ss.activated_at_olt_id,
      ss.previous_status,
      ss.status_changed_at
    FROM stock_serials ss
    LEFT JOIN stock_items si ON si.id = ss.stock_item_id
    LEFT JOIN stock_locations sl ON sl.id = ss.current_location_id
    LEFT JOIN projects p ON p.id = ss.allocated_to_project_id
    WHERE ss.serial_number = $1
    LIMIT 1
    `,
    [serialNumber]
  );
  const r = serialRes.rows[0];
  if (!r) return null;

  const serial: SerialDetail = {
    id: r.id,
    serialNumber: r.serial_number,
    macAddress: r.mac_address,
    category: r.category,
    itemName: r.item_name,
    status: r.status,
    currentLocationName: r.location_name,
    allocatedProjectName: r.project_name,
    installedAtDropNumber: r.drop_number,
    installedDate: toIso(r.installed_date),
    receivedDate: toIso(r.received_date),
    activatedAtOltId: r.activated_at_olt_id,
  };

  const eventsRes = await pool.query<EventRow>(
    `
    SELECT
      sse.id,
      sse.event_type,
      sse.from_state,
      sse.to_state,
      sse.occurred_at,
      sse.source_table,
      sse.source_id,
      sse.payload,
      COALESCE(
        NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
        NULLIF(TRIM(COALESCE(st.first_name, '') || ' ' || COALESCE(st.last_name, '')), '')
      ) AS actor_name
    FROM stock_serial_events sse
    LEFT JOIN users u  ON u.id  = sse.actor_user_id
    LEFT JOIN staff st ON st.id = sse.actor_staff_id
    WHERE sse.serial_id = $1
    ORDER BY sse.occurred_at DESC
    `,
    [r.id]
  );

  const realEvents: TimelineEntry[] = eventsRes.rows.map((e) => ({
    kind: 'event',
    id: e.id,
    eventType: e.event_type,
    fromState: e.from_state,
    toState: e.to_state,
    occurredAt: toIso(e.occurred_at) ?? new Date(0).toISOString(),
    sourceTable: e.source_table,
    sourceId: e.source_id,
    actorName: e.actor_name,
    payload: e.payload ?? {},
  }));

  const realEventTypes = new Set<string>(
    realEvents.flatMap((e) => (e.kind === 'event' ? [e.eventType] : []))
  );

  const pseudo: TimelineEntry[] = [];

  if (r.received_date) {
    const occurredAt = toIso(r.received_date);
    if (occurredAt) {
      pseudo.push({
        kind: 'pseudo',
        id: `pseudo-received-${r.id}`,
        label: 'Received into stock',
        occurredAt,
        description: 'Inferred from stock_serials.received_date',
      });
    }
  }

  if (
    r.installed_date &&
    (r.status === 'installed' || r.status === 'activated') &&
    !realEventTypes.has('installed_at_drop')
  ) {
    const occurredAt = toIso(r.installed_date);
    if (occurredAt) {
      pseudo.push({
        kind: 'pseudo',
        id: `pseudo-installed-${r.id}`,
        label: 'Installed at drop',
        occurredAt,
        description: `Drop ${r.drop_number ?? 'unknown'} — inferred from stock_serials.installed_date`,
      });
    }
  }

  if (
    r.activated_at_olt_id &&
    r.status === 'activated' &&
    !realEventTypes.has('activated')
  ) {
    const occurredAt =
      toIso(r.status_changed_at) ?? toIso(r.installed_date) ?? new Date().toISOString();
    pseudo.push({
      kind: 'pseudo',
      id: `pseudo-activated-${r.id}`,
      label: 'Activated on OLT',
      occurredAt,
      description: `OLT ${r.activated_at_olt_id} — inferred from stock_serials.activated_at_olt_id`,
    });
  }

  if (
    r.status_changed_at &&
    r.previous_status &&
    r.previous_status !== r.status &&
    realEvents.length === 0
  ) {
    const occurredAt = toIso(r.status_changed_at);
    if (occurredAt) {
      pseudo.push({
        kind: 'pseudo',
        id: `pseudo-status-${r.id}`,
        label: 'Status changed',
        occurredAt,
        description: `${r.previous_status} → ${r.status}`,
      });
    }
  }

  const all = [...realEvents, ...pseudo].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );

  return { serial, entries: all, hasRealEvents: realEvents.length > 0 };
}
