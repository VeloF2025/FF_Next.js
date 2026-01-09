/**
 * Client Section - Client contact information
 * 🟢 WORKING: Form section for client details
 */

'use client';

import { User } from 'lucide-react';
import type { TicketFormData, TicketFormErrors } from '../../../hooks/useTicketForm';

interface ClientSectionProps {
  formData: TicketFormData;
  errors: TicketFormErrors;
  setField: <K extends keyof TicketFormData>(field: K, value: TicketFormData[K]) => void;
  disabled?: boolean;
}

export function ClientSection({ formData, errors, setField, disabled }: ClientSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-lg font-semibold text-[var(--ff-text-primary)]">
        <User className="w-5 h-5 text-blue-400" />
        Client Information
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Client Name */}
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            Client Name
          </label>
          <input
            type="text"
            value={formData.client_name}
            onChange={(e) => setField('client_name', e.target.value)}
            placeholder="Full name"
            disabled={disabled}
            className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
        </div>

        {/* Client Contact */}
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            Contact Number
          </label>
          <input
            type="tel"
            value={formData.client_contact}
            onChange={(e) => setField('client_contact', e.target.value)}
            placeholder="+27 82 123 4567"
            disabled={disabled}
            className={`w-full px-3 py-2 rounded-lg border bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              errors.client_contact ? 'border-red-500' : 'border-[var(--ff-border-light)]'
            } disabled:opacity-50`}
          />
          {errors.client_contact && (
            <p className="mt-1 text-sm text-red-400">{errors.client_contact}</p>
          )}
        </div>

        {/* Client Email */}
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            Email Address
          </label>
          <input
            type="email"
            value={formData.client_email}
            onChange={(e) => setField('client_email', e.target.value)}
            placeholder="client@example.com"
            disabled={disabled}
            className={`w-full px-3 py-2 rounded-lg border bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              errors.client_email ? 'border-red-500' : 'border-[var(--ff-border-light)]'
            } disabled:opacity-50`}
          />
          {errors.client_email && (
            <p className="mt-1 text-sm text-red-400">{errors.client_email}</p>
          )}
        </div>
      </div>
    </div>
  );
}
