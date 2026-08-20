/**
 * Queue rows and bulk-acknowledgement selection (Task 8 split: table only —
 * filters/composition live in `IncidentQueue.tsx`, detail in
 * `IncidentReviewDrawer.tsx`). Status is never colour-only: the overdue and
 * condition badges always carry a text word, colour is a bonus.
 *
 * The "Driver input" column (PR7 review I4) is read-only — it renders
 * `incident.driverInput.state`, computed server-side by
 * `../reviewQueries.ts#attachDriverInputSummaries` via the same
 * `deriveDriverInputState` the detail drawer's badge uses, so the queue and
 * the drawer can never disagree. No filter control was added: a client-only
 * `driverInputState` queue filter was already tried and removed from this
 * branch once because the server never implemented it — this task adds a
 * visible indicator only, per the review's explicit instruction not to
 * reintroduce a filter without server-side enforcement in the same commit.
 */
import type { IncidentListItem, IncidentLifecycleStatus, IncidentSeverity, IncidentType } from '../types';
import type { DriverInputState } from '../driver/types';

/** No cell text for `not_requested` — nothing to flag a manager's attention with yet, mirrors the drawer's own badge suppression for this state. */
const DRIVER_INPUT_LABELS: Partial<Record<DriverInputState, string>> = {
  requested: 'Awaiting driver', responded: 'Driver responded',
  expired: 'Response expired', closed: 'Response closed',
};

const TERMINAL: readonly IncidentLifecycleStatus[] = ['resolved', 'dismissed'];

const TYPE_LABELS: Record<IncidentType, string> = {
  late: 'Late', wrong_site: 'Wrong site', evidence_mismatch: 'Evidence mismatch', left_early: 'Left early',
  unassigned: 'Unassigned', unverifiable: 'Unverifiable', evidence_gap: 'Evidence gap',
  vehicle_on_site_driver_unconfirmed: 'Vehicle on site — driver unconfirmed',
  accident_sos: 'Accident / SOS', dangerous_area_entry: 'Dangerous area entry',
  theft_after_hours_movement: 'Theft — after-hours movement', severe_driving: 'Severe driving',
  prolonged_unauthorized_stop: 'Prolonged unauthorized stop', lost_contact_moving: 'Lost contact while moving',
};
const LIFECYCLE_LABELS: Record<IncidentLifecycleStatus, string> = {
  open: 'Open', acknowledged: 'Acknowledged', under_review: 'Under review', resolved: 'Resolved', dismissed: 'Dismissed',
};
const SEVERITY_LABELS: Record<IncidentSeverity, string> = { normal: 'Normal', high: 'High', critical: 'Critical' };

function sast(value: string | null): string {
  return value ? new Date(value).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }) : '—';
}

function AckState({ incident, now }: { incident: IncidentListItem; now: Date }) {
  if (incident.lifecycleStatus !== 'open' || !incident.nextEscalationAt) return <span>—</span>;
  const remainingMs = new Date(incident.nextEscalationAt).getTime() - now.getTime();
  if (remainingMs <= 0) return <span className="font-medium text-red-700">Overdue (escalation level {incident.escalationLevel})</span>;
  const minutes = Math.ceil(remainingMs / 60_000);
  return <span>Due in {minutes} min</span>;
}

function ConditionState({ incident }: { incident: IncidentListItem }) {
  return incident.conditionClearedAt
    ? <span>Cleared {sast(incident.conditionClearedAt)}</span>
    : <span className="font-medium">Active</span>;
}

function DriverInputCell({ incident }: { incident: IncidentListItem }) {
  const label = DRIVER_INPUT_LABELS[incident.driverInput.state];
  if (!label) return <span>—</span>;
  return <span className={incident.driverInput.state === 'responded' ? 'font-medium' : undefined}>{label}</span>;
}

export interface IncidentTableProps {
  incidents: IncidentListItem[];
  canEdit: boolean;
  selected: ReadonlySet<string>;
  onToggleSelect: (incidentId: string) => void;
  onOpen: (incidentId: string) => void;
  now?: Date;
}

export function IncidentTable({ incidents, canEdit, selected, onToggleSelect, onOpen, now = new Date() }: IncidentTableProps) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-[var(--ff-border-light)] text-xs uppercase text-[var(--ff-text-tertiary)]">
          {canEdit && <th scope="col" className="p-2"><span className="sr-only">Select</span></th>}
          <th scope="col" className="p-2">Reference</th>
          <th scope="col" className="p-2">Staff</th>
          <th scope="col" className="p-2">Project / site</th>
          <th scope="col" className="p-2">Type / severity</th>
          <th scope="col" className="p-2">Status</th>
          <th scope="col" className="p-2">Condition</th>
          <th scope="col" className="p-2">Opened</th>
          <th scope="col" className="p-2">Acknowledgement</th>
          <th scope="col" className="p-2">Evidence</th>
          <th scope="col" className="p-2">Driver input</th>
        </tr>
      </thead>
      <tbody>
        {incidents.map((incident) => {
          const selectable = canEdit && !TERMINAL.includes(incident.lifecycleStatus);
          return (
            <tr key={incident.id} data-testid={`incident-row-${incident.id}`} className="border-b border-[var(--ff-border-light)]">
              {canEdit && (
                <td className="p-2">
                  {selectable && (
                    <input type="checkbox" aria-label={`Select incident ${incident.incidentReference}`}
                      checked={selected.has(incident.id)} onChange={() => onToggleSelect(incident.id)} />
                  )}
                </td>
              )}
              <td className="p-2">
                <button type="button" onClick={() => onOpen(incident.id)} className="font-medium text-[var(--ff-primary)] underline">
                  {incident.incidentReference}
                </button>
              </td>
              <td className="p-2">{incident.staffName ?? 'Unassigned'}</td>
              <td className="p-2">{incident.projectName ?? 'No project'} · {incident.operationalSiteName ?? 'No site'}</td>
              <td className="p-2">{TYPE_LABELS[incident.incidentType]} · {SEVERITY_LABELS[incident.severity]}</td>
              <td className="p-2">{LIFECYCLE_LABELS[incident.lifecycleStatus]}</td>
              <td className="p-2"><ConditionState incident={incident} /></td>
              <td className="p-2">{sast(incident.openedAt)}</td>
              <td className="p-2"><AckState incident={incident} now={now} /></td>
              <td className="p-2">{incident.evidenceCount} attachment{incident.evidenceCount === 1 ? '' : 's'}</td>
              <td className="p-2"><DriverInputCell incident={incident} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
