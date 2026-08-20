import type { OperationalStatusGroup, OperationalStatusGroupCount } from '../presentationTypes';

const CONTROLS: Array<{ group: OperationalStatusGroup; label: string }> = [
  { group: 'on_site', label: 'On site' },
  { group: 'approaching', label: 'Approaching' },
  { group: 'late', label: 'Late' },
  { group: 'wrong_site', label: 'Wrong site' },
  { group: 'unverifiable', label: 'Unverifiable' },
  { group: 'unassigned', label: 'Unassigned' },
];

interface StatusCountBarProps {
  groups: OperationalStatusGroupCount[];
  selected: OperationalStatusGroup | undefined;
  onSelect: (group: OperationalStatusGroup | undefined) => void;
}

export function StatusCountBar({ groups, selected, onSelect }: StatusCountBarProps) {
  const counts = new Map(groups.map((item) => [item.group, item.count]));
  return (
    <div data-testid="status-count-bar" className="flex gap-2 overflow-x-auto pb-2 lg:grid lg:grid-cols-6 lg:overflow-visible">
      {CONTROLS.map(({ group, label }) => {
        const count = counts.get(group) ?? 0;
        const pressed = selected === group;
        return (
          <button
            key={group}
            type="button"
            aria-label={`${label} ${count}`}
            aria-pressed={pressed}
            onClick={() => onSelect(pressed ? undefined : group)}
            className={`min-w-32 flex-none rounded-lg border px-3 py-3 text-left transition-colors lg:min-w-0 ${pressed
              ? 'border-[var(--ff-primary)] bg-[var(--ff-primary)] text-white'
              : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]'}`}
          >
            <span className="block text-2xl font-semibold">{count}</span>
            <span className="text-sm">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
