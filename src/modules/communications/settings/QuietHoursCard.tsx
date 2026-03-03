'use client';

/**
 * QuietHoursCard
 * Toggle quiet hours on/off and configure the start/end time window.
 * During quiet hours, non-urgent notifications are suppressed.
 */

import { Moon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UserCommunicationSettings } from '@/modules/communications/types/settings.types';

interface QuietHoursCardProps {
  settings: UserCommunicationSettings;
  onChange: (patch: Partial<UserCommunicationSettings>) => void;
}

export function QuietHoursCard({ settings, onChange }: QuietHoursCardProps) {
  return (
    <div className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-5">
      {/* Card header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Moon className="w-4 h-4 text-[var(--ff-text-secondary)]" />
          <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">Quiet Hours</h3>
        </div>

        {/* Toggle switch */}
        <button
          type="button"
          role="switch"
          aria-checked={settings.quiet_hours_enabled}
          onClick={() => onChange({ quiet_hours_enabled: !settings.quiet_hours_enabled })}
          className={cn(
            'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent',
            'transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)] focus:ring-offset-2',
            settings.quiet_hours_enabled ? 'bg-[var(--ff-primary)]' : 'bg-[var(--ff-border-light)]'
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200',
              settings.quiet_hours_enabled ? 'translate-x-4' : 'translate-x-0'
            )}
          />
        </button>
      </div>

      <p className="text-xs text-[var(--ff-text-secondary)] mb-4">
        Non-critical notifications will be silenced between the hours below.
      </p>

      {/* Time inputs — only interactive when enabled */}
      <div
        className={cn(
          'flex items-center gap-4 transition-opacity',
          !settings.quiet_hours_enabled && 'opacity-40 pointer-events-none'
        )}
      >
        <label className="flex flex-col gap-1 text-xs text-[var(--ff-text-secondary)]">
          Start
          <input
            type="time"
            value={settings.quiet_hours_start}
            onChange={e => onChange({ quiet_hours_start: e.target.value })}
            className={cn(
              'px-2 py-1.5 rounded-md border border-[var(--ff-border-light)]',
              'bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] text-sm',
              'focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]'
            )}
          />
        </label>

        <span className="text-[var(--ff-text-tertiary)] text-sm mt-4">to</span>

        <label className="flex flex-col gap-1 text-xs text-[var(--ff-text-secondary)]">
          End
          <input
            type="time"
            value={settings.quiet_hours_end}
            onChange={e => onChange({ quiet_hours_end: e.target.value })}
            className={cn(
              'px-2 py-1.5 rounded-md border border-[var(--ff-border-light)]',
              'bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] text-sm',
              'focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]'
            )}
          />
        </label>
      </div>
    </div>
  );
}
