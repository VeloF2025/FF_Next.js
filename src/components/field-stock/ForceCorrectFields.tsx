/**
 * ForceCorrectFields — shared controlled form component for force-correcting
 * stock serial state. Used by:
 *   - SerialDetailPage (single-serial modal)
 *   - ForceCorrectAdminPage (batch apply)
 *
 * This component bypasses the serial state machine intentionally — the red
 * warning banner makes that explicit to the operator.
 */

import type { ForceCorrectStatus, ForceCorrectTarget } from '@/types/field-stock';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ForceCorrectCurrentValues {
  status?: string | null;
  currentLocationId?: string | null;
  allocatedToProjectId?: string | null;
  installedAtDropNumber?: string | null;
  activatedAtOltId?: string | null;
}

export interface ForceCorrectFieldsProps {
  value: ForceCorrectTarget;
  reason: string;
  onChange: (next: ForceCorrectTarget) => void;
  onReasonChange: (next: string) => void;
  currentValues?: ForceCorrectCurrentValues;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: ForceCorrectStatus[] = [
  'available', 'reserved', 'allocated_to_project', 'in_transit', 'issued',
  'installed', 'activated', 'faulty', 'in_repair', 'returned', 'scrapped',
];

type NullableMode = 'keep' | 'clear' | 'set';

type NullableField = 'currentLocationId' | 'allocatedToProjectId' | 'installedAtDropNumber' | 'activatedAtOltId';

const NULLABLE_FIELDS: { key: NullableField; label: string; mono?: boolean }[] = [
  { key: 'currentLocationId', label: 'Current location ID' },
  { key: 'allocatedToProjectId', label: 'Allocated project ID' },
  { key: 'installedAtDropNumber', label: 'Installed at drop', mono: true },
  { key: 'activatedAtOltId', label: 'Activated on OLT', mono: true },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function modeFor(val: string | null | undefined): NullableMode {
  if (val === undefined) return 'keep';
  if (val === null) return 'clear';
  return 'set';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ForceCorrectFields({
  value,
  reason,
  onChange,
  onReasonChange,
  currentValues,
}: ForceCorrectFieldsProps) {
  const reasonLen = reason.trim().length;
  const reasonOk = reasonLen >= 10;

  function setStatus(s: ForceCorrectStatus | undefined) {
    const next = { ...value };
    if (s === undefined) {
      delete next.status;
    } else {
      next.status = s;
    }
    onChange(next);
  }

  function setNullable(field: NullableField, mode: NullableMode, text?: string) {
    const next = { ...value };
    if (mode === 'keep') {
      delete next[field];
    } else if (mode === 'clear') {
      next[field] = null;
    } else {
      next[field] = text ?? '';
    }
    onChange(next);
  }

  return (
    <div className="space-y-4">
      {/* Warning banner */}
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
        <span className="font-semibold">Caution — state-machine bypass.</span>{' '}
        This applies changes directly to the database without validating lifecycle rules. Every
        change is audit-logged. Use only to correct data errors.
      </div>

      {/* Status field */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wide">
          Status
        </label>
        {currentValues?.status !== undefined && (
          <p className="text-xs text-[var(--ff-text-secondary)]">
            Current: <span className="font-mono">{currentValues.status ?? '—'}</span>
          </p>
        )}
        <select
          value={value.status ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            setStatus(v === '' ? undefined : (v as ForceCorrectStatus));
          }}
          className="w-full rounded-md border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] px-3 py-2 text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-border-focus)]"
        >
          <option value="">(leave unchanged)</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Nullable ID fields */}
      {NULLABLE_FIELDS.map(({ key, label, mono }) => {
        const mode = modeFor(value[key]);
        const current = currentValues?.[key];
        return (
          <div key={key} className="space-y-1">
            <label className="block text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wide">
              {label}
            </label>
            {current !== undefined && (
              <p className="text-xs text-[var(--ff-text-secondary)]">
                Current:{' '}
                <span className={mono ? 'font-mono' : ''}>{current ?? '—'}</span>
              </p>
            )}
            <div className="flex gap-2">
              {(['keep', 'clear', 'set'] as NullableMode[]).map((m) => (
                <label key={m} className="flex items-center gap-1.5 cursor-pointer text-sm text-[var(--ff-text-primary)]">
                  <input
                    type="radio"
                    name={key}
                    value={m}
                    checked={mode === m}
                    onChange={() => setNullable(key, m, mode === 'set' ? (value[key] as string | undefined) ?? '' : '')}
                    className="accent-[var(--ff-primary-500)]"
                  />
                  {m === 'keep' ? 'Keep' : m === 'clear' ? 'Clear (NULL)' : 'Set to…'}
                </label>
              ))}
            </div>
            {mode === 'set' && (
              <input
                type="text"
                value={(value[key] as string) ?? ''}
                onChange={(e) => setNullable(key, 'set', e.target.value)}
                placeholder={`Enter ${label.toLowerCase()}`}
                className={`mt-1 w-full rounded-md border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] px-3 py-2 text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-border-focus)] ${mono ? 'font-mono' : ''}`}
              />
            )}
          </div>
        );
      })}

      {/* Reason textarea */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wide">
          Reason <span className="text-red-400">*</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          rows={3}
          placeholder="Explain why this manual correction is necessary (min 10 characters)"
          className="w-full rounded-md border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] px-3 py-2 text-sm text-[var(--ff-text-primary)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--ff-border-focus)]"
        />
        <p className={`text-right text-xs ${reasonOk ? 'text-[var(--ff-text-secondary)]' : 'text-red-400'}`}>
          {reasonLen} / 10 min chars
        </p>
      </div>
    </div>
  );
}
