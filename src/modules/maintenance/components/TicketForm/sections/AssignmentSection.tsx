/**
 * Assignment Section - User, Contractor, Team assignment
 * 🟢 WORKING: Form section for ticket assignment
 */

'use client';

import { Users } from 'lucide-react';
import type { TicketFormData, TicketFormErrors } from '../../../hooks/useTicketForm';

interface AssignmentSectionProps {
  formData: TicketFormData;
  errors: TicketFormErrors;
  setField: <K extends keyof TicketFormData>(field: K, value: TicketFormData[K]) => void;
  disabled?: boolean;
}

export function AssignmentSection({ formData, errors, setField, disabled }: AssignmentSectionProps) {
  // TODO: Fetch users, contractors, and teams from API
  // For now, use text fields that accept UUIDs or names

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-lg font-semibold text-[var(--ff-text-primary)]">
        <Users className="w-5 h-5 text-blue-400" />
        Assignment
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Assigned To (User) */}
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            Assign to Technician
          </label>
          <input
            type="text"
            value={formData.assigned_to}
            onChange={(e) => setField('assigned_to', e.target.value)}
            placeholder="User ID or name"
            disabled={disabled}
            className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-[var(--ff-text-muted)]">
            Leave empty to auto-assign later
          </p>
        </div>

        {/* Assigned Contractor */}
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            Assign to Contractor
          </label>
          <input
            type="text"
            value={formData.assigned_contractor_id}
            onChange={(e) => setField('assigned_contractor_id', e.target.value)}
            placeholder="Contractor ID or name"
            disabled={disabled}
            className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
        </div>

        {/* Assigned Team */}
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            Assign to Team
          </label>
          <input
            type="text"
            value={formData.assigned_team}
            onChange={(e) => setField('assigned_team', e.target.value)}
            placeholder="Team name"
            disabled={disabled}
            className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
        </div>
      </div>

      <p className="text-sm text-[var(--ff-text-muted)]">
        You can assign to a specific technician, contractor, or team. The ticket will be marked as &quot;Assigned&quot; status when saved with an assignment.
      </p>
    </div>
  );
}
