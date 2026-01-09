/**
 * Equipment Section - ONT information
 * 🟢 WORKING: Form section for equipment details
 */

'use client';

import { Cpu } from 'lucide-react';
import type { TicketFormData, TicketFormErrors } from '../../../hooks/useTicketForm';

interface EquipmentSectionProps {
  formData: TicketFormData;
  errors: TicketFormErrors;
  setField: <K extends keyof TicketFormData>(field: K, value: TicketFormData[K]) => void;
  disabled?: boolean;
}

export function EquipmentSection({ formData, errors, setField, disabled }: EquipmentSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-lg font-semibold text-[var(--ff-text-primary)]">
        <Cpu className="w-5 h-5 text-blue-400" />
        Equipment Information
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* ONT Serial */}
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            ONT Serial Number
          </label>
          <input
            type="text"
            value={formData.ont_serial}
            onChange={(e) => setField('ont_serial', e.target.value)}
            placeholder="e.g., HWTC12345678"
            disabled={disabled}
            className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
        </div>

        {/* ONT RX Level */}
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            ONT RX Level (dBm)
          </label>
          <input
            type="number"
            value={formData.ont_rx_level}
            onChange={(e) => setField('ont_rx_level', e.target.value)}
            placeholder="-25.5"
            step="0.1"
            min="-40"
            max="0"
            disabled={disabled}
            className={`w-full px-3 py-2 rounded-lg border bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              errors.ont_rx_level ? 'border-red-500' : 'border-[var(--ff-border-light)]'
            } disabled:opacity-50`}
          />
          {errors.ont_rx_level ? (
            <p className="mt-1 text-sm text-red-400">{errors.ont_rx_level}</p>
          ) : (
            <p className="mt-1 text-xs text-[var(--ff-text-muted)]">
              Valid range: -40 to 0 dBm
            </p>
          )}
        </div>

        {/* ONT Model */}
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
            ONT Model
          </label>
          <input
            type="text"
            value={formData.ont_model}
            onChange={(e) => setField('ont_model', e.target.value)}
            placeholder="e.g., Huawei EG8145V5"
            disabled={disabled}
            className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}
