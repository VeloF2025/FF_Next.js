/**
 * PPDataRow — single data row for the PP Data table.
 * Actions column: ExternalLink to /activate/[dropNumber] and per-row Ticket select icon.
 * NO `import React` — automatic JSX runtime.
 */

'use client';

import { memo } from 'react';
import { ExternalLink, MapPin, Ticket, CheckSquare, Square } from 'lucide-react';
import { formatDisplayDate } from '@/utils/dateFormat';
import { type PPRecord, STATUS_COLORS, daysAgo, ageBadgeStyle, isSelectable } from './ppDataShared';

interface PPDataRowProps {
  record: PPRecord;
  isSelected: boolean;
  onToggleSelect: (id: number) => void;
}

export const PPDataRow = memo(function PPDataRow({ record, isSelected, onToggleSelect }: PPDataRowProps) {
  const statusStyle = STATUS_COLORS[record.resolution_status] ?? {
    bg: 'bg-[var(--ff-bg-tertiary)]',
    text: 'text-[var(--ff-text-secondary)]',
    label: record.resolution_status,
  };
  const selectable = isSelectable(record);

  return (
    <tr className={`border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] ${isSelected ? 'bg-[var(--ff-accent)]/10' : ''}`}>
      {/* Checkbox */}
      <td className="w-12 py-3 px-4">
        {selectable ? (
          <button onClick={() => onToggleSelect(record.id)} className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-accent)]" aria-label={isSelected ? 'Deselect' : 'Select'}>
            {isSelected ? <CheckSquare className="w-5 h-5 text-[var(--ff-accent)]" /> : <Square className="w-5 h-5" />}
          </button>
        ) : <span className="w-5 h-5 block" />}
      </td>
      <td className="py-3 px-4 font-mono text-[var(--ff-text-primary)]">{record.serial_number}</td>
      <td className="py-3 px-4 text-[var(--ff-text-secondary)]">{record.project}</td>
      <td className="py-3 px-4">
        <span className={`px-2 py-1 rounded text-xs ${statusStyle.bg} ${statusStyle.text}`}>{statusStyle.label}</span>
      </td>
      <td className="py-3 px-4 font-mono text-[var(--ff-text-primary)]">{record.resolved_drop_number || '-'}</td>
      <td className="py-3 px-4 text-[var(--ff-text-secondary)] text-xs text-center">{record.zone_no ?? '-'}</td>
      <td className="py-3 px-4 text-[var(--ff-text-secondary)] text-xs text-center">{record.pon_no ?? '-'}</td>
      <td className="py-3 px-4 text-[var(--ff-text-secondary)] text-xs font-mono whitespace-nowrap">
        {record.olt_port ? <span title={record.olt_address ?? undefined}>{record.olt_port}</span> : '-'}
      </td>
      <td className="py-3 px-4 text-[var(--ff-text-secondary)]" title="Date the serial first appeared on the OES PP sheet">
        {record.date_registered ? formatDisplayDate(record.date_registered) : '-'}
      </td>
      <td className="py-3 px-4 text-[var(--ff-text-secondary)] text-xs" title="Date the resolve process first linked this serial to a DR">
        {record.first_resolved_at ? formatDisplayDate(record.first_resolved_at) : '-'}
      </td>
      <td className="py-3 px-4 text-[var(--ff-text-secondary)] text-xs" title="OES activation date">
        {record.activation_date ? formatDisplayDate(record.activation_date) : '-'}
      </td>
      <td className="py-3 px-4 text-[var(--ff-text-secondary)] text-xs">{record.oes_team || '-'}</td>
      <td className="py-3 px-4 text-xs">
        {record.wa_name ? (
          <div>
            <span className="text-[var(--ff-text-primary)]">{record.wa_name}</span>
            {record.technician_source === 'eod' && <span className="ml-1 text-[10px] text-[var(--ff-text-tertiary)]" title="From EOD install sheet">(EOD)</span>}
            {record.wa_phone && <span className="block text-[var(--ff-text-tertiary)] font-mono text-[10px]">{record.wa_phone}</span>}
          </div>
        ) : '-'}
      </td>
      <td className="py-3 px-4 text-[var(--ff-text-secondary)]">{record.resolved_source || '-'}</td>
      <td className="py-3 px-4">
        {record.ticket_uid
          ? <a href={`/noc/tickets/${record.maintenance_ticket_id}`} className="text-blue-400 hover:text-blue-300 text-xs font-mono">{record.ticket_uid}</a>
          : <span className="text-[var(--ff-text-tertiary)]">-</span>}
      </td>
      <td className="py-3 px-4">
        {record.ticket_priority ? (
          <div className="flex items-center gap-1.5">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${record.ticket_priority === 'high' ? 'bg-red-500/20 text-red-400' : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]'}`}>
              {record.ticket_priority === 'high' ? 'High' : 'Normal'}
            </span>
            {(() => { const days = daysAgo(record.ticket_created_at); if (days === null) return null; return <span className={`px-1.5 py-0.5 rounded border text-[10px] font-mono font-medium ${ageBadgeStyle(days)}`}>{days}d</span>; })()}
          </div>
        ) : <span className="text-[var(--ff-text-tertiary)]">-</span>}
      </td>
      {/* Actions: ExternalLink to DR + Ticket select icon */}
      <td className="py-3 px-4 text-right">
        <div className="flex items-center justify-end gap-1">
          {record.latitude != null && record.longitude != null
            ? <a href={`https://maps.google.com/?q=${record.latitude},${record.longitude}`} target="_blank" rel="noopener noreferrer" className="p-1.5 text-[var(--ff-text-secondary)] hover:text-[var(--ff-accent)] transition-colors" title="View location on map"><MapPin className="w-4 h-4" /></a>
            : <span className="inline-block w-7 h-7" />}
          {record.resolved_drop_number
            ? <a href={`/activate/${record.resolved_drop_number}`} target="_blank" rel="noopener noreferrer" className="p-1.5 text-[var(--ff-text-secondary)] hover:text-[var(--ff-accent)] transition-colors" title="View DR in Activate"><ExternalLink className="w-4 h-4" /></a>
            : <span className="inline-block w-7 h-7" />}
          {selectable && (
            <button onClick={() => onToggleSelect(record.id)} className={`p-1.5 transition-colors ${isSelected ? 'text-[var(--ff-accent)]' : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-accent)]'}`} title={isSelected ? 'Deselect for ticketing' : 'Select for ticketing'}>
              <Ticket className="w-4 h-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
});
