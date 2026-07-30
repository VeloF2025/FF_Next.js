import type { ZoneRegisterResult } from '../types/zoneDelivery.types';

interface ZoneDeliverySummaryProps {
  summary: ZoneRegisterResult['summary'];
}

const metrics: Array<{ key: keyof ZoneRegisterResult['summary']; label: string }> = [
  { key: 'zones', label: 'Zones' },
  { key: 'includedPons', label: 'Approved-scope PONs' },
  { key: 'livePons', label: 'Technically live PONs' },
  { key: 'readyForQa', label: 'Ready for Zone QA' },
  { key: 'handedOver', label: 'Handed over' },
];

export function ZoneDeliverySummary({ summary }: ZoneDeliverySummaryProps) {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {metrics.map(metric => (
        <div key={metric.key} className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-3">
          <dt className="text-xs font-medium text-[var(--ff-text-secondary)]">{metric.label}</dt>
          <dd className="mt-1 text-2xl font-semibold text-[var(--ff-text-primary)]">
            {summary[metric.key].toLocaleString()}
          </dd>
        </div>
      ))}
    </dl>
  );
}
