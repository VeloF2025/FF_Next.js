/**
 * Fault Section - Fault cause attribution (maintenance tickets only)
 * 🟢 WORKING: Form section for fault classification
 */

'use client';

import { AlertTriangle } from 'lucide-react';
import { FaultCause, TicketType } from '../../../types/ticket';
import { FAULT_CAUSE_LABELS, type TicketFormData, type TicketFormErrors } from '../../../hooks/useTicketForm';

interface FaultSectionProps {
  formData: TicketFormData;
  errors: TicketFormErrors;
  setField: <K extends keyof TicketFormData>(field: K, value: TicketFormData[K]) => void;
  disabled?: boolean;
}

const FAULT_CAUSE_DESCRIPTIONS: Record<FaultCause, string> = {
  [FaultCause.WORKMANSHIP]: 'Installation or repair work quality issue',
  [FaultCause.MATERIAL_FAILURE]: 'Equipment or material defect',
  [FaultCause.CLIENT_DAMAGE]: 'Damage caused by client actions',
  [FaultCause.THIRD_PARTY]: 'Damage by external parties (construction, etc.)',
  [FaultCause.ENVIRONMENTAL]: 'Weather, natural causes',
  [FaultCause.VANDALISM]: 'Intentional damage/theft',
  [FaultCause.UNKNOWN]: 'Cause not yet determined',
};

export function FaultSection({ formData, errors, setField, disabled }: FaultSectionProps) {
  // Only show for maintenance tickets
  if (formData.ticket_type !== TicketType.MAINTENANCE) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-lg font-semibold text-[var(--ff-text-primary)]">
        <AlertTriangle className="w-5 h-5 text-amber-400" />
        Fault Attribution
        <span className="text-xs font-normal text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded-full">
          Maintenance Only
        </span>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
        <p className="text-sm text-amber-400">
          <strong>Important:</strong> Accurate fault attribution is critical for fair contractor evaluation.
          Select &quot;Unknown&quot; if unsure - this can be updated after investigation.
        </p>
      </div>

      {/* Fault Cause Selection */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
          Fault Cause <span className="text-red-400">*</span>
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
          {Object.entries(FAULT_CAUSE_LABELS).map(([value, label]) => {
            const isSelected = formData.fault_cause === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setField('fault_cause', value as FaultCause)}
                disabled={disabled}
                className={`text-left p-3 rounded-lg border transition-colors ${
                  isSelected
                    ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                    : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:border-[var(--ff-border-medium)] hover:text-[var(--ff-text-primary)]'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <div className="font-medium text-sm">{label}</div>
                <div className="text-xs opacity-70 mt-0.5">
                  {FAULT_CAUSE_DESCRIPTIONS[value as FaultCause]}
                </div>
              </button>
            );
          })}
        </div>
        {errors.fault_cause && (
          <p className="mt-1 text-sm text-red-400">{errors.fault_cause}</p>
        )}
      </div>

      {/* Fault Details */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Fault Details
          <span className="text-[var(--ff-text-muted)] font-normal ml-1">(Optional)</span>
        </label>
        <textarea
          value={formData.fault_cause_details}
          onChange={(e) => setField('fault_cause_details', e.target.value)}
          placeholder="Additional details about the fault cause..."
          rows={3}
          disabled={disabled}
          className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 resize-none"
        />
      </div>
    </div>
  );
}
