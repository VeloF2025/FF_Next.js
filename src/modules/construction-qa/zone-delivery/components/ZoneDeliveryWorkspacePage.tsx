'use client';

import { RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { usePermission } from '@/hooks/usePermission';
import { useZoneDeliveryZone } from '../hooks/useZoneDeliveryZone';
import type { ZoneDeliveryStatus, ZoneKey } from '../types/zoneDelivery.types';
import { HandoverEvidencePanel } from './HandoverEvidencePanel';
import { PonMilestoneTable } from './PonMilestoneTable';
import { ZoneActivityTimeline } from './ZoneActivityTimeline';
import { ZoneLifecycleRail } from './ZoneLifecycleRail';
import { ZoneQaPanels } from './ZoneQaPanels';
import { ZoneDeliverySnags } from './ZoneDeliverySnags';
import { ZoneDeliveryTimestamp } from './ZoneDeliveryTimestamp';

const permissions = {
  scope: 'construction-qa.zone-delivery.scope-manage',
  construction: 'construction-qa.zone-delivery.construction-confirm',
  testing: 'construction-qa.zone-delivery.testing-confirm',
  operations: 'construction-qa.zone-delivery.operations-confirm',
  zoneQa: 'construction-qa.zone-delivery.zone-qa-approve',
  documents: 'construction-qa.zone-delivery.documents-manage',
} as const;
const statusLabels: Record<ZoneDeliveryStatus, string> = {
  handed_over: 'Handed over', scope_pending: 'Scope pending', handover_blocked: 'Handover blocked',
  zone_qa_in_progress: 'Zone QA in progress', ready_for_zone_qa: 'Ready for Zone QA',
  go_live_in_progress: 'Go-live in progress', awaiting_port_approval: 'Awaiting port approval',
  ready_for_port_submission: 'Ready for port submission', testing_in_progress: 'Testing in progress',
  optical_construction: 'Optical construction', civil_construction: 'Civil construction',
};
const contextQuery = (key: ZoneKey, ponNo?: number) => {
  const base = `project_id=${encodeURIComponent(key.projectId)}&zone_no=${key.zoneNo}`;
  return `${base}${ponNo === undefined ? '' : `&pon_no=${ponNo}`}`;
};

export function ZoneDeliveryWorkspacePage({ zoneKey }: { zoneKey: ZoneKey }) {
  const delivery = useZoneDeliveryZone(zoneKey);
  const { can } = usePermission();
  if (delivery.loading && !delivery.zone) {
    return <div className="py-16"><LoadingSpinner label="Loading zone delivery workspace" /></div>;
  }
  if (!delivery.zone) {
    return (
      <div role="alert" className="rounded border border-red-500/40 p-4 text-red-300">
        {delivery.error ?? 'Zone delivery data is unavailable.'}
        <button type="button" onClick={() => void delivery.refresh()} className="ml-3 underline">Retry</button>
      </div>
    );
  }
  const zone = delivery.zone;
  const included = zone.pons.filter(pon => pon.scopeStatus === 'included');
  const live = included.filter(pon => pon.milestones.technically_live);
  const links = [
    ['Works QA', `/field-ops/works-qa?${contextQuery(zoneKey)}`],
    ['OTDR', `/field-ops/otdr?${contextQuery(zoneKey)}`],
    ['Snags', `/field-ops/snags?${contextQuery(zoneKey)}`],
  ];
  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <a href="/field-ops" className="text-sm underline" aria-label="Back to zone register">← Back to zone register</a>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">{zone.projectName} Zone {zone.zoneNo}</h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {zone.scopeApproved
                ? `${live.length} / ${included.length} technically live`
                : 'Approved scope not set'}
            </p>
            <p className="text-sm text-[var(--ff-text-secondary)]">{zone.blockers.length} blocker(s)</p>
            <p className="text-sm">{statusLabels[zone.status]}</p>
            {zone.eligibleForZoneQaAt && <p className="text-sm">Eligible for Zone QA: <ZoneDeliveryTimestamp value={zone.eligibleForZoneQaAt} label="Eligible for Zone QA time" /></p>}
            {zone.handedOverAt && <p className="text-sm">Handed over: <ZoneDeliveryTimestamp value={zone.handedOverAt} label="Handover time" /></p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {links.map(([label, href]) => <a key={label} href={href} className="rounded border border-[var(--border-color)] px-3 py-2 text-sm">{label}</a>)}
            <button type="button" disabled={delivery.refreshing} onClick={() => void delivery.refresh()} className="flex items-center gap-2 rounded border border-[var(--border-color)] px-3 py-2 text-sm disabled:opacity-60">
              <RefreshCw className={`h-4 w-4 ${delivery.refreshing ? 'animate-spin' : ''}`} />
              {delivery.refreshing ? 'Refreshing' : 'Refresh'}
            </button>
          </div>
        </div>
        {delivery.lastUpdated && <p className="text-xs text-[var(--ff-text-secondary)]">Updated: {delivery.lastUpdated.toLocaleTimeString()}</p>}
      </header>
      {delivery.error && (
        <div role="alert" className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {delivery.error}
          <button type="button" onClick={() => void delivery.refresh()} className="ml-3 underline" aria-label="Refresh current zone">Refresh</button>
        </div>
      )}
      {zone.blockers.length > 0 && (
        <section aria-labelledby="blockers-heading" className="rounded-lg border border-amber-500/40 p-4">
          <h2 id="blockers-heading" className="mb-2 font-semibold">Server blockers</h2>
          <ul className="space-y-2">{zone.blockers.map((blocker, index) => (
            <li key={`${blocker.code}-${blocker.entityId ?? index}`} className="text-sm">
              {blocker.message}
              {blocker.code === 'OPEN_HANDOVER_SNAGS' && <a className="ml-2 underline" aria-label="Open in Snags" href={`/field-ops/snags?${contextQuery(zoneKey, blocker.ponNo)}`}>Open in Snags</a>}
            </li>
          ))}</ul>
        </section>
      )}
      <ZoneLifecycleRail />
      <PonMilestoneTable
        zone={zone}
        permissions={{
          scope: can(permissions.scope, 'edit'),
          construction: can(permissions.construction, 'edit'),
          testing: can(permissions.testing, 'edit'),
          operations: can(permissions.operations, 'edit'),
        }}
        mutating={delivery.mutating}
        onScope={delivery.updateScope}
        onMilestone={delivery.confirmMilestone}
      />
      <ZoneQaPanels zone={zone} canApprove={can(permissions.zoneQa, 'edit')} mutating={delivery.mutating} onRecord={delivery.recordZoneQa} />
      <ZoneDeliverySnags zone={zone} />
      <HandoverEvidencePanel zone={zone} canManage={can(permissions.documents, 'edit')} mutating={delivery.mutating} onUpload={delivery.uploadDocument} />
      <ZoneActivityTimeline activity={delivery.activity} />
    </div>
  );
}
