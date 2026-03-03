'use client';

/**
 * NotificationPreferencesGrid
 * Renders a grouped table of notification event types with channel checkboxes.
 * Rows = event types, Columns = in_app, email, whatsapp
 * Events are grouped by their MODULE (e.g. Maintenance, Projects, Procurement).
 */

import React from 'react';
import { cn } from '@/lib/utils';
import type { MergedPreference } from '@/modules/notifications/types';

interface NotificationPreferencesGridProps {
  preferences: MergedPreference[];
  updatePreference: (
    eventType: string,
    channel: 'in_app' | 'email' | 'whatsapp',
    value: boolean
  ) => void;
}

interface GroupedPreferences {
  [group: string]: MergedPreference[];
}

const CHANNEL_COLUMNS: { key: 'in_app' | 'email' | 'whatsapp'; label: string }[] = [
  { key: 'in_app', label: 'In-App' },
  { key: 'email', label: 'Email' },
  { key: 'whatsapp', label: 'WhatsApp' },
];

/** Group preferences by their `group` field, preserving insertion order */
function groupPreferences(preferences: MergedPreference[]): GroupedPreferences {
  return preferences.reduce<GroupedPreferences>((acc, pref) => {
    const key = pref.group || 'Other';
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(pref);
    return acc;
  }, {});
}

/** Single channel checkbox cell */
function ChannelCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <td className="px-4 py-2.5 text-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        aria-label={label}
        className="w-4 h-4 rounded accent-[var(--ff-primary)] cursor-pointer"
      />
    </td>
  );
}

export function NotificationPreferencesGrid({
  preferences,
  updatePreference,
}: NotificationPreferencesGridProps) {
  const grouped = groupPreferences(preferences);
  const groups = Object.keys(grouped);

  if (preferences.length === 0) {
    return (
      <p className="text-sm text-[var(--ff-text-secondary)] text-center py-8">
        No notification preferences available.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
            <th className="px-4 py-3 text-left font-medium text-[var(--ff-text-secondary)]">
              Event
            </th>
            {CHANNEL_COLUMNS.map(col => (
              <th
                key={col.key}
                className="px-4 py-3 text-center font-medium text-[var(--ff-text-secondary)] w-24"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(group => (
            <React.Fragment key={group}>
              {/* Group header row */}
              <tr className="bg-[var(--ff-bg-secondary)]">
                <td
                  colSpan={4}
                  className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--ff-text-tertiary)]"
                >
                  {group}
                </td>
              </tr>
              {/* Event rows */}
              {(grouped[group] ?? []).map((pref, idx) => (
                <tr
                  key={pref.event_type}
                  className={cn(
                    'border-t border-[var(--ff-border-light)] transition-colors',
                    'hover:bg-[var(--ff-bg-tertiary)]',
                    idx % 2 === 0
                      ? 'bg-[var(--ff-bg-primary)]'
                      : 'bg-[var(--ff-bg-secondary)]'
                  )}
                >
                  <td className="px-4 py-2.5">
                    <span className="text-[var(--ff-text-primary)]">{pref.label}</span>
                    {pref.is_user_override && (
                      <span className="ml-2 px-1.5 py-0.5 text-[10px] font-medium bg-[var(--ff-primary)]/10 text-[var(--ff-primary)] rounded">
                        custom
                      </span>
                    )}
                  </td>
                  <ChannelCheckbox
                    checked={pref.channel_in_app}
                    onChange={v => updatePreference(pref.event_type, 'in_app', v)}
                    label={`${pref.label} in-app`}
                  />
                  <ChannelCheckbox
                    checked={pref.channel_email}
                    onChange={v => updatePreference(pref.event_type, 'email', v)}
                    label={`${pref.label} email`}
                  />
                  <ChannelCheckbox
                    checked={pref.channel_whatsapp}
                    onChange={v => updatePreference(pref.event_type, 'whatsapp', v)}
                    label={`${pref.label} WhatsApp`}
                  />
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
