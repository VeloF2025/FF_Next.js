/**
 * Competency picker for a certificate submission.
 *
 * One certificate frequently covers several competencies — a rope-access course
 * that certifies both Working at Heights and Fall Arrest — so this is a
 * multi-select rather than a dropdown, and each selection becomes its own
 * queryable training record.
 */

import type { HSTrainingType } from '../../types/training.types';

export interface TrainingTypeMultiSelectProps {
  types: HSTrainingType[];
  selectedIds: string[];
  onChange(ids: string[]): void;
  disabled?: boolean;
}

export function TrainingTypeMultiSelect({
  types,
  selectedIds,
  onChange,
  disabled,
}: TrainingTypeMultiSelectProps) {
  // A retired competency must not be selectable, but one already chosen stays
  // visible so the selection cannot silently shrink underneath the user.
  const selectable = types.filter((type) => type.is_active || selectedIds.includes(type.id));

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id]);
  }

  return (
    <fieldset className="space-y-2">
      <legend className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
        Competencies this certificate proves *
      </legend>

      <div className="grid gap-1 sm:grid-cols-2 max-h-56 overflow-y-auto p-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
        {selectable.length === 0 && (
          <p className="text-sm text-[var(--ff-text-secondary)]">No active training types.</p>
        )}
        {selectable.map((type) => (
          <label
            key={type.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-[var(--ff-bg-tertiary)]"
          >
            <input
              type="checkbox"
              disabled={disabled}
              checked={selectedIds.includes(type.id)}
              onChange={() => toggle(type.id)}
              className="rounded border-[var(--ff-border-light)]"
            />
            <span className="text-sm text-[var(--ff-text-primary)]">
              {type.name}
              {type.is_statutory && (
                <span className="ml-1 text-xs text-[var(--ff-text-secondary)]">(statutory)</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The selected competencies, rendered as chips for the review step and lists. */
export function TrainingTypeChips({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {names.map((name) => (
        <span
          key={name}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--ff-primary-500)]/15 text-[var(--ff-primary-600)]"
        >
          {name}
        </span>
      ))}
    </div>
  );
}
