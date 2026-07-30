import type { PonMilestone, ZoneDeliveryStatus, ZoneQaStatus, ZoneRegisterRow } from '../types/zoneDelivery.types';

interface ZoneDeliveryTableProps {
  rows: ZoneRegisterRow[];
}

const qaLabels: Record<ZoneQaStatus, string> = {
  not_started: 'Not started', in_progress: 'In progress', passed: 'Passed', failed: 'Failed',
};
const gateLabels: Record<PonMilestone, string> = {
  civil_complete: 'Civil complete', optical_complete: 'Optical complete', testing_passed: 'Testing passed',
  port_submitted: 'Port submitted', port_approved: 'Port approved', technically_live: 'Technically live',
};
const statusLabels: Record<ZoneDeliveryStatus, string> = {
  handed_over: 'Handed over', scope_pending: 'Scope pending', handover_blocked: 'Handover blocked',
  zone_qa_in_progress: 'Zone QA in progress', ready_for_zone_qa: 'Ready for Zone QA',
  go_live_in_progress: 'Go-live in progress', awaiting_port_approval: 'Awaiting port approval',
  ready_for_port_submission: 'Ready for port submission', testing_in_progress: 'Testing in progress',
  optical_construction: 'Optical construction', civil_construction: 'Civil construction',
};

function QaBadge({ status }: { status: ZoneQaStatus }) {
  return <span className="rounded-full bg-[var(--hover-bg)] px-2 py-1 text-xs text-[var(--ff-text-primary)]">{qaLabels[status]}</span>;
}

export function ZoneDeliveryTable({ rows }: ZoneDeliveryTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-color)]">
      <table className="min-w-[960px] w-full text-left text-sm">
        <thead className="bg-[var(--hover-bg)] text-xs uppercase text-[var(--ff-text-secondary)]"><tr>
          <th className="px-4 py-3">Project / Zone</th><th className="px-4 py-3">Live PONs</th>
          <th className="px-4 py-3">Current gate</th><th className="px-4 py-3">Blockers</th>
          <th className="px-4 py-3">Civil Zone QA</th><th className="px-4 py-3">Optical Zone QA</th><th className="px-4 py-3">Handover</th>
        </tr></thead>
        <tbody className="divide-y divide-[var(--border-color)]">
          {rows.map(row => {
            const href = `/field-ops/zone?project_id=${encodeURIComponent(row.projectId)}&zone_no=${row.zoneNo}`;
            return <tr key={`${row.projectId}-${row.zoneNo}`} className="text-[var(--ff-text-primary)]">
              <td className="px-4 py-3 font-medium"><a className="underline hover:text-blue-400" href={href}>{row.projectName} Zone {row.zoneNo}</a></td>
              <td className="px-4 py-3">{row.livePons} / {row.includedPons}</td>
              <td className="px-4 py-3">{row.earliestIncompleteGate ? gateLabels[row.earliestIncompleteGate] : 'Complete'}</td>
              <td className="px-4 py-3">{row.blockerCount}</td><td className="px-4 py-3"><QaBadge status={row.civilQa} /></td>
              <td className="px-4 py-3"><QaBadge status={row.opticalQa} /></td>
              <td className="px-4 py-3">{row.handedOverAt ? row.handedOverAt.slice(0, 10) : statusLabels[row.status]}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}
