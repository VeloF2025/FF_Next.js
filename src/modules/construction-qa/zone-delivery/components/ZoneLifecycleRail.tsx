import type { PonMilestone } from '../types/zoneDelivery.types';

const gates: Array<{ gate: PonMilestone; label: string }> = [
  { gate: 'civil_complete', label: 'Civil complete' },
  { gate: 'optical_complete', label: 'Optical complete' },
  { gate: 'testing_passed', label: 'Testing passed' },
  { gate: 'port_submitted', label: 'Port submitted' },
  { gate: 'port_approved', label: 'Port approved' },
  { gate: 'technically_live', label: 'Technically live' },
];

export function ZoneLifecycleRail() {
  return (
    <section aria-labelledby="lifecycle-heading" className="rounded-lg border border-[var(--border-color)] p-4">
      <h2 id="lifecycle-heading" className="mb-3 font-semibold text-[var(--ff-text-primary)]">PON lifecycle</h2>
      <ol className="grid gap-2 md:grid-cols-6">
        {gates.map(({ gate, label }) => (
          <li key={gate} data-testid="lifecycle-gate" className="rounded bg-[var(--hover-bg)] p-3 text-sm text-[var(--ff-text-primary)]">
            {label}
          </li>
        ))}
      </ol>
    </section>
  );
}
