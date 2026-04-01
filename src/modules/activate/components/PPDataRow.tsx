'use client';

import React from 'react';
import { formatDisplayDate } from '@/utils/dateFormat';
import { type PPRecord, STATUS_COLORS, daysAgo, ageBadgeStyle, isSelectable } from './ppDataShared';

export const PPDataRow = React.memo(function PPDataRow({
  record,
  isSelected,
  onToggleSelect,
}: {
  record: PPRecord;
  isSelected: boolean;
  onToggleSelect: (id: number) => void;
}) {
  const statusStyle = STATUS_COLORS[record.resolution_status] || {
    bg: 'bg-background/30', text: 'text-foreground', label: record.resolution_status,
  };
  const selectable = isSelectable(record);
  return (
    <tr className={`bg-[var(--ff-bg-secondary)] ${isSelected ? 'bg-blue-900/10' : ''}`}>
      <td className="px-3 py-2">
        {selectable ? (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(record.id)}
            className="rounded border-gray-600"
          />
        ) : null}
      </td>
      <td className="px-3 py-2 font-mono text-[var(--ff-text-primary)]">{record.serial_number}</td>
      <td className="px-3 py-2 text-[var(--ff-text-secondary)]">{record.project}</td>
      <td className="px-3 py-2">
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
          {statusStyle.label}
        </span>
      </td>
      <td className="px-3 py-2 font-mono text-[var(--ff-text-primary)]">
        {record.resolved_drop_number || '-'}
      </td>
      <td className="px-3 py-2 text-[var(--ff-text-secondary)] text-xs text-center">
        {record.zone_no ?? '-'}
      </td>
      <td className="px-3 py-2 text-[var(--ff-text-secondary)] text-xs text-center">
        {record.pon_no ?? '-'}
      </td>
      <td className="px-3 py-2 text-[var(--ff-text-secondary)]">
        {record.date_registered ? formatDisplayDate(record.date_registered) : '-'}
      </td>
      <td className="px-3 py-2 text-[var(--ff-text-secondary)] text-xs">
        {record.oes_team || '-'}
      </td>
      <td className="px-3 py-2 text-[var(--ff-text-secondary)] text-xs">
        {record.activation_date ? formatDisplayDate(record.activation_date) : '-'}
      </td>
      <td className="px-3 py-2 text-xs">
        {record.wa_name ? (
          <div>
            <span className="text-[var(--ff-text-primary)]">{record.wa_name}</span>
            {record.wa_phone && (
              <span className="block text-[var(--ff-text-tertiary)] font-mono text-[10px]">{record.wa_phone}</span>
            )}
          </div>
        ) : '-'}
      </td>
      <td className="px-3 py-2 text-[var(--ff-text-secondary)]">
        {record.resolved_source || '-'}
      </td>
      <td className="px-3 py-2">
        {record.ticket_uid ? (
          <a
            href={`/noc/tickets/${record.maintenance_ticket_id}`}
            className="text-blue-400 hover:text-blue-300 text-xs font-mono"
          >
            {record.ticket_uid}
          </a>
        ) : (
          <span className="text-[var(--ff-text-tertiary)]">-</span>
        )}
      </td>
      <td className="px-3 py-2">
        {record.ticket_priority ? (
          <div className="flex items-center gap-1.5">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              record.ticket_priority === 'high'
                ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                : 'bg-gray-100 dark:bg-gray-800/30 text-gray-700 dark:text-gray-300'
            }`}>
              {record.ticket_priority === 'high' ? 'High' : 'Normal'}
            </span>
            {(() => {
              const days = daysAgo(record.ticket_created_at);
              if (days === null) return null;
              return (
                <span className={`px-1.5 py-0.5 rounded border text-[10px] font-mono font-medium ${ageBadgeStyle(days)}`}>
                  {days}d
                </span>
              );
            })()}
          </div>
        ) : (
          <span className="text-[var(--ff-text-tertiary)]">-</span>
        )}
      </td>
    </tr>
  );
});

export const TABLE_HEADERS = [
  'Serial', 'Project', 'Status', 'DR', 'Zone', 'PON', 'Registered',
  'Install Team', 'Activation', 'WA Technician', 'Source', 'Ticket', 'Priority',
] as const;

export function PPDataTableHead({
  showSelectAll,
  allChecked,
  onToggleAll,
}: {
  showSelectAll: boolean;
  allChecked: boolean;
  onToggleAll: () => void;
}) {
  return (
    <thead className="bg-[var(--ff-bg-tertiary)] sticky top-0">
      <tr>
        <th className="px-3 py-2 w-10">
          {showSelectAll && (
            <input type="checkbox" checked={allChecked} onChange={onToggleAll} className="rounded border-gray-600" />
          )}
        </th>
        {TABLE_HEADERS.map(h => (
          <th key={h} className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">{h}</th>
        ))}
      </tr>
    </thead>
  );
}
