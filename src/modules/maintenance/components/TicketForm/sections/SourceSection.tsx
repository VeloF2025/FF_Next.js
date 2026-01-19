/**
 * Source Section - Source, Ticket Type, and Priority selection
 * 🟢 WORKING: Form section for ticket classification
 */

'use client';

import { Tag, AlertTriangle, Zap, Wrench, PlusCircle, RefreshCw, AlertCircle } from 'lucide-react';
import {
  TicketSource,
  TicketType,
  TicketPriority,
} from '../../../types/ticket';
import {
  TICKET_SOURCE_LABELS,
  TICKET_TYPE_LABELS,
  TICKET_PRIORITY_LABELS,
  PRIORITY_COLORS,
  type TicketFormData,
  type TicketFormErrors,
} from '../../../hooks/useTicketForm';

interface SourceSectionProps {
  formData: TicketFormData;
  errors: TicketFormErrors;
  setField: <K extends keyof TicketFormData>(field: K, value: TicketFormData[K]) => void;
  disabled?: boolean;
}

const TICKET_TYPE_ICONS: Record<TicketType, React.ReactNode> = {
  [TicketType.MAINTENANCE]: <Wrench className="w-4 h-4" />,
  [TicketType.NEW_INSTALLATION]: <PlusCircle className="w-4 h-4" />,
  [TicketType.MODIFICATION]: <RefreshCw className="w-4 h-4" />,
  [TicketType.ONT_SWAP]: <RefreshCw className="w-4 h-4" />,
  [TicketType.INCIDENT]: <AlertCircle className="w-4 h-4" />,
};

export function SourceSection({ formData, errors, setField, disabled }: SourceSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-lg font-semibold text-[var(--ff-text-primary)]">
        <Tag className="w-5 h-5 text-blue-400" />
        Source & Classification
      </div>

      {/* Source Dropdown */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Ticket Source <span className="text-red-400">*</span>
        </label>
        <select
          value={formData.source}
          onChange={(e) => setField('source', e.target.value as TicketSource)}
          disabled={disabled}
          className={`w-full px-3 py-2 rounded-lg border bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.source ? 'border-red-500' : 'border-[var(--ff-border-light)]'
          } disabled:opacity-50`}
        >
          {Object.entries(TICKET_SOURCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {errors.source && (
          <p className="mt-1 text-sm text-red-400">{errors.source}</p>
        )}
      </div>

      {/* Ticket Type - Card Selection */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
          Ticket Type <span className="text-red-400">*</span>
        </label>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {Object.entries(TICKET_TYPE_LABELS).map(([value, label]) => {
            const isSelected = formData.ticket_type === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setField('ticket_type', value as TicketType)}
                disabled={disabled}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-colors ${
                  isSelected
                    ? 'bg-blue-500/20 border-blue-500 text-blue-400'
                    : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:border-[var(--ff-border-medium)] hover:text-[var(--ff-text-primary)]'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {TICKET_TYPE_ICONS[value as TicketType]}
                <span className="text-xs font-medium">{label}</span>
              </button>
            );
          })}
        </div>
        {errors.ticket_type && (
          <p className="mt-1 text-sm text-red-400">{errors.ticket_type}</p>
        )}
      </div>

      {/* Priority Dropdown */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Priority
        </label>
        <div className="flex flex-wrap gap-2">
          {Object.entries(TICKET_PRIORITY_LABELS).map(([value, label]) => {
            const isSelected = formData.priority === value;
            const colorClass = PRIORITY_COLORS[value as TicketPriority];
            return (
              <button
                key={value}
                type="button"
                onClick={() => setField('priority', value as TicketPriority)}
                disabled={disabled}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  isSelected
                    ? colorClass + ' ring-2 ring-offset-2 ring-offset-[var(--ff-bg-secondary)]'
                    : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
