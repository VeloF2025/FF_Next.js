import { Fragment } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { sumCounts } from '../deriveStatus';
import { projectKey, zoneKey } from '../treeKeys';
import type {
  DeliveryCounts,
  DeliveryTreeProject,
  PonDeliveryStatus,
  ZoneDeliveryStatus,
} from '../types';

type RowStatus = ZoneDeliveryStatus | PonDeliveryStatus;

interface DeliveryTreeTableProps {
  projects: DeliveryTreeProject[];
  expanded: ReadonlySet<string>;
  onToggle: (key: string) => void;
}

const badgeClasses: Record<RowStatus, string> = {
  Maintenance: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'Optical Submitted': 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  WIP: 'bg-[var(--hover-bg)] text-[var(--ff-text-secondary)]',
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: '2-digit',
});

function StatusBadge({ status }: { status: RowStatus }) {
  return (
    <span className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${badgeClasses[status]}`}>
      {status}
    </span>
  );
}

function CountCells({ counts }: { counts: DeliveryCounts }) {
  return (
    <>
      <td className="px-4 py-2 text-right tabular-nums">{counts.poles_planted}</td>
      <td className="px-4 py-2 text-right tabular-nums">{counts.poles_total}</td>
      <td className="px-4 py-2 text-right tabular-nums">{counts.activation_complete}</td>
      <td className="px-4 py-2 text-right tabular-nums">{counts.activation_total}</td>
    </>
  );
}

function ToggleCell({ label, indent, open, onToggle }: {
  label: string; indent: number; open: boolean; onToggle: () => void;
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <td className="px-4 py-2" style={{ paddingLeft: `${indent}rem` }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex items-center gap-2 text-left font-medium text-[var(--ff-text-primary)]"
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {label}
      </button>
    </td>
  );
}

export function DeliveryTreeTable({ projects, expanded, onToggle }: DeliveryTreeTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-color)]">
      <table className="w-full min-w-[820px] text-left text-sm text-[var(--ff-text-primary)]">
        <thead className="bg-[var(--hover-bg)] text-xs uppercase text-[var(--ff-text-secondary)]">
          <tr>
            <th className="px-4 py-3">Project / Zone / PON</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Poles planted</th>
            <th className="px-4 py-3 text-right">Poles total</th>
            <th className="px-4 py-3 text-right">Activations done</th>
            <th className="px-4 py-3 text-right">Activations total</th>
            <th className="px-4 py-3">Optical submitted</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-color)]">
          {projects.map(project => {
            const pKey = projectKey(project.id);
            const projectOpen = expanded.has(pKey);
            return (
              <Fragment key={pKey}>
                <tr className="bg-[var(--hover-bg)]">
                  <ToggleCell label={project.name} indent={1} open={projectOpen} onToggle={() => onToggle(pKey)} />
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{project.zones.length} zones</td>
                  <CountCells counts={sumCounts(project.zones.map(zone => zone.counts))} />
                  <td className="px-4 py-2" />
                </tr>
                {projectOpen && project.zones.map(zone => {
                  const zKey = zoneKey(project.id, zone.zone_no);
                  const zoneOpen = expanded.has(zKey);
                  return (
                    <Fragment key={zKey}>
                      <tr>
                        <ToggleCell label={`Zone ${zone.zone_no}`} indent={2.5} open={zoneOpen} onToggle={() => onToggle(zKey)} />
                        <td className="px-4 py-2"><StatusBadge status={zone.status} /></td>
                        <CountCells counts={zone.counts} />
                        <td className="px-4 py-2" />
                      </tr>
                      {zoneOpen && zone.pons.map(pon => (
                        <tr key={`${zKey}:${pon.pon_no}`}>
                          <td className="px-4 py-2 pl-16 text-[var(--ff-text-secondary)]">PON {pon.pon_no}</td>
                          <td className="px-4 py-2"><StatusBadge status={pon.status} /></td>
                          <CountCells counts={pon.counts} />
                          <td className="px-4 py-2 text-[var(--ff-text-secondary)]">
                            {pon.opticalSubmittedAt ? (
                              <time dateTime={pon.opticalSubmittedAt}>
                                {dateFormatter.format(new Date(pon.opticalSubmittedAt))}
                              </time>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
