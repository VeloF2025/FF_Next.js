import { useEffect, useState } from 'react';
import type { MilestoneCommand, ScopeCommand } from '../hooks/useZoneDeliveryZone';
import type { PonDeliveryView, PonMilestone, ScopeStatus, ZoneDeliveryView } from '../types/zoneDelivery.types';
import { ZoneDeliveryActionDialog, type AuditedActionValues } from './ZoneDeliveryActionDialog';
import { ZoneDeliveryTimestamp } from './ZoneDeliveryTimestamp';

interface Props {
  zone: ZoneDeliveryView;
  permissions: { scope: boolean; construction: boolean; testing: boolean; operations: boolean };
  mutating: boolean;
  onScope: (input: ScopeCommand) => Promise<boolean>;
  onMilestone: (input: MilestoneCommand) => Promise<boolean>;
}
type MilestoneAction = { type: 'milestone'; pon: PonDeliveryView; gate: PonMilestone; action: 'confirm' | 'reopen' };
type MaintenanceAction = { type: 'maintenance'; pon: PonDeliveryView };
type Action = MilestoneAction | MaintenanceAction | { type: 'scope' } | null;
const gates: PonMilestone[] = [
  'civil_complete', 'optical_complete', 'testing_passed',
  'port_submitted', 'port_approved', 'technically_live',
];
const milestoneLabels: Record<PonMilestone, string> = {
  civil_complete: 'Civil complete', optical_complete: 'Optical complete',
  testing_passed: 'Testing passed', port_submitted: 'Port submitted',
  port_approved: 'Port approved', technically_live: 'Technically live',
};
const blockerGate: Record<string, PonMilestone> = {
  PON_CIVIL_INCOMPLETE: 'civil_complete',
  PON_OPTICAL_INCOMPLETE: 'optical_complete',
  PON_TESTING_INCOMPLETE: 'testing_passed',
  PON_PORT_NOT_SUBMITTED: 'port_submitted',
  PON_PORT_NOT_APPROVED: 'port_approved',
  PON_NOT_LIVE: 'technically_live',
};
const gatePermission = (gate: PonMilestone, permissions: Props['permissions']) => {
  if (gate === 'civil_complete' || gate === 'optical_complete') return permissions.construction;
  if (gate === 'testing_passed') return permissions.testing;
  return permissions.operations;
};
const query = (zone: ZoneDeliveryView, ponNo?: number) => {
  const params = `project_id=${encodeURIComponent(zone.projectId)}&zone_no=${zone.zoneNo}`;
  return `${params}${ponNo === undefined ? '' : `&pon_no=${ponNo}`}`;
};

export function PonMilestoneTable({
  zone, permissions, mutating, onScope, onMilestone,
}: Props) {
  const [action, setAction] = useState<Action>(null);
  const [scope, setScope] = useState(() => zone.pons.map(pon => ({
    ponStageId: pon.ponStageId, scopeStatus: pon.scopeStatus, reason: '',
  })));
  const [snagId, setSnagId] = useState('');
  const [affectedGate, setAffectedGate] = useState<PonMilestone>('civil_complete');
  const scopeBlocker = zone.blockers.find(blocker =>
    blocker.code === 'SCOPE_NOT_APPROVED' || blocker.code === 'EMPTY_INCLUDED_SCOPE');
  useEffect(() => {
    if (action?.type === 'scope') return;
    setScope(zone.pons.map(pon => ({
      ponStageId: pon.ponStageId, scopeStatus: pon.scopeStatus, reason: '',
    })));
  }, [action?.type, zone.pons]);
  const terminal = zone.status === 'handed_over';
  const submit = async (meta: AuditedActionValues) => {
    if (!action) return false;
    if (action.type === 'scope') {
      const pons = scope.map(({ reason, ...pon }) => ({
        ...pon, ...(reason.trim() ? { reason: reason.trim() } : {}),
      }));
      if (pons.length === 0) return false;
      return onScope({ ...meta, expectedRowVersion: zone.rowVersion, pons });
    } else if (action.type === 'maintenance') {
      return onMilestone({
        ...meta, expectedRowVersion: action.pon.rowVersion,
        ponStageId: action.pon.ponStageId, milestone: affectedGate,
        action: 'link_maintenance', snagId, affectedGate,
      });
    } else {
      return onMilestone({
        ...meta, expectedRowVersion: action.pon.rowVersion,
        ponStageId: action.pon.ponStageId, milestone: action.gate, action: action.action,
        ...(action.action === 'reopen'
          ? { snagId, affectedGate: action.gate }
          : {}),
      });
    }
  };
  const title = action?.type === 'scope' ? 'Manage approved PON scope'
    : action?.type === 'maintenance' ? `Link maintenance issue for PON ${action.pon.ponNo}`
      : action?.type === 'milestone'
        ? `${action.action === 'reopen' ? 'Reopen' : 'Confirm'} ${milestoneLabels[action.gate]} for PON ${action.pon.ponNo}`
        : '';

  return (
    <section aria-labelledby="pons-heading" className="rounded-lg border border-[var(--border-color)]">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div><h2 id="pons-heading" className="font-semibold text-[var(--ff-text-primary)]">PON milestones</h2><p className="text-xs text-[var(--ff-text-secondary)]">Works QA and OTDR evidence is context only; milestones require supervised confirmation.</p></div>
        {permissions.scope && !terminal && zone.pons.length > 0 && <button type="button" onClick={() => setAction({ type: 'scope' })} className="rounded border border-[var(--border-color)] px-3 py-2 text-sm">Manage scope</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[1280px] w-full text-left text-sm">
          <thead className="bg-[var(--hover-bg)] text-xs uppercase"><tr><th className="px-3 py-2">PON / Scope</th>{gates.map(gate => <th key={gate} className="px-3 py-2">{milestoneLabels[gate]}</th>)}<th className="px-3 py-2">Evidence / Actions</th></tr></thead>
          <tbody className="divide-y divide-[var(--border-color)]">
            {zone.pons.map(pon => (
              <tr key={pon.ponStageId} aria-label={`PON ${pon.ponNo} ${pon.scopeStatus[0]!.toUpperCase()}${pon.scopeStatus.slice(1)}`}>
                <td className="px-3 py-3"><div className="font-medium">PON {pon.ponNo}</div><div>{pon.scopeStatus[0]!.toUpperCase()}{pon.scopeStatus.slice(1)}</div></td>
                {gates.map(gate => {
                  const evidence = pon.milestones[gate];
                  return <td key={gate} className="px-3 py-3 align-top">
                    {evidence ? <><div><ZoneDeliveryTimestamp value={evidence.effectiveAt} label={`PON ${pon.ponNo} ${milestoneLabels[gate]} effective time`} /></div><div className="text-xs">{evidence.actorEmail}</div><div className="text-xs">{evidence.source}</div>{evidence.reconfirmedAt && <div className="text-xs">Reconfirmed <ZoneDeliveryTimestamp value={evidence.reconfirmedAt} label={`PON ${pon.ponNo} ${milestoneLabels[gate]} reconfirmed time`} /></div>}</> : <span>Not confirmed</span>}
                    {!terminal && pon.scopeStatus === 'included' && gatePermission(gate, permissions) && (() => {
                      const ponBlocker = zone.blockers.find(blocker => blocker.entityId === pon.ponStageId);
                      const disabledReason = evidence ? undefined : scopeBlocker?.message
                        ?? (ponBlocker && blockerGate[ponBlocker.code] !== gate ? ponBlocker.message : undefined);
                      const descriptionId = disabledReason ? `pon-${pon.ponStageId}-${gate}-blocker` : undefined;
                      return <><button type="button" disabled={Boolean(disabledReason)} title={disabledReason} aria-describedby={descriptionId} onClick={() => setAction({ type: 'milestone', pon, gate, action: evidence ? 'reopen' : 'confirm' })} className="mt-2 block text-xs underline disabled:opacity-50" aria-label={`${evidence ? 'Reopen' : 'Confirm'} ${milestoneLabels[gate]} for PON ${pon.ponNo}`}>{evidence ? 'Reopen' : 'Confirm'}</button>{disabledReason && <span id={descriptionId} className="sr-only">{disabledReason}</span>}</>;
                    })()}
                  </td>;
                })}
                <td className="px-3 py-3 align-top">
                  <a className="block underline" href={`/field-ops/works-qa?${query(zone, pon.ponNo)}`} aria-label={`PON ${pon.ponNo} Works QA`}>Works QA</a>
                  <a className="block underline" href={`/field-ops/otdr?${query(zone, pon.ponNo)}`} aria-label={`PON ${pon.ponNo} OTDR`}>OTDR</a>
                  <a className="block underline" href={`/field-ops/snags?${query(zone, pon.ponNo)}`} aria-label={`PON ${pon.ponNo} Snags`}>Snags</a>
                  {permissions.operations && terminal && <button type="button" onClick={() => setAction({ type: 'maintenance', pon })} className="mt-2 text-xs underline" aria-label={`Link maintenance issue for PON ${pon.ponNo}`}>Link maintenance</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ZoneDeliveryActionDialog open={action !== null} title={title} submitting={mutating} requireReason={action?.type === 'maintenance' || action?.type === 'milestone' && action.action === 'reopen'} onClose={() => setAction(null)} onSubmit={submit}>
        {action?.type === 'scope' && <div className="space-y-3">{scope.map((pon, index) => {
          const view = zone.pons[index]!;
          return <div key={pon.ponStageId} className="rounded bg-[var(--hover-bg)] p-3"><div className="font-medium">PON {view.ponNo}</div><label className="block text-sm">Scope status PON {view.ponNo}<select value={pon.scopeStatus} onChange={event => setScope(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, scopeStatus: event.target.value as ScopeStatus } : item))} className="mt-1 w-full rounded border bg-transparent p-2"><option value="included">Included</option><option value="excluded">Excluded</option><option value="cancelled">Cancelled</option></select></label>{pon.scopeStatus !== 'included' && <label className="mt-2 block text-sm">Scope reason PON {view.ponNo}<input required value={pon.reason} onChange={event => setScope(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, reason: event.target.value } : item))} className="mt-1 w-full rounded border bg-transparent p-2" /></label>}</div>;
        })}</div>}
        {action?.type === 'maintenance' && <><label className="block text-sm">Snag ID<input required value={snagId} onChange={event => setSnagId(event.target.value)} className="mt-1 w-full rounded border bg-transparent p-2" /></label><label className="block text-sm">Affected gate<select value={affectedGate} onChange={event => setAffectedGate(event.target.value as PonMilestone)} className="mt-1 w-full rounded border bg-transparent p-2">{gates.map(gate => <option key={gate} value={gate}>{milestoneLabels[gate]}</option>)}</select></label></>}
        {action?.type === 'milestone' && action.action === 'reopen' && <label className="block text-sm">Snag ID<input required value={snagId} onChange={event => setSnagId(event.target.value)} className="mt-1 w-full rounded border bg-transparent p-2" /></label>}
      </ZoneDeliveryActionDialog>
    </section>
  );
}
