/**
 * Details Section - Title, Description, External ID
 * 🟢 WORKING: Form section for ticket details
 */

'use client';

import { FileText } from 'lucide-react';
import type { TicketFormData, TicketFormErrors } from '../../../hooks/useTicketForm';

interface DetailsSectionProps {
  formData: TicketFormData;
  errors: TicketFormErrors;
  setField: <K extends keyof TicketFormData>(field: K, value: TicketFormData[K]) => void;
  disabled?: boolean;
}

export function DetailsSection({ formData, errors, setField, disabled }: DetailsSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-lg font-semibold text-[var(--ff-text-primary)]">
        <FileText className="w-5 h-5 text-blue-400" />
        Ticket Details
      </div>

      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Title <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={formData.title}
          onChange={(e) => setField('title', e.target.value)}
          placeholder="Brief description of the issue..."
          maxLength={255}
          disabled={disabled}
          className={`w-full px-3 py-2 rounded-lg border bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.title ? 'border-red-500' : 'border-[var(--ff-border-light)]'
          } disabled:opacity-50`}
        />
        <div className="flex justify-between mt-1">
          {errors.title ? (
            <p className="text-sm text-red-400">{errors.title}</p>
          ) : (
            <span />
          )}
          <span className="text-xs text-[var(--ff-text-muted)]">
            {formData.title.length}/255
          </span>
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Description
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => setField('description', e.target.value)}
          placeholder="Detailed description of the issue, symptoms, and any relevant context..."
          rows={4}
          disabled={disabled}
          className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 resize-none"
        />
      </div>

      {/* External ID */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          External Reference ID
          <span className="text-[var(--ff-text-muted)] font-normal ml-1">(Optional)</span>
        </label>
        <input
          type="text"
          value={formData.external_id}
          onChange={(e) => setField('external_id', e.target.value)}
          placeholder="QContact ID, report line number, etc."
          disabled={disabled}
          className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <p className="mt-1 text-xs text-[var(--ff-text-muted)]">
          Link this ticket to an external system reference
        </p>
      </div>
    </div>
  );
}
