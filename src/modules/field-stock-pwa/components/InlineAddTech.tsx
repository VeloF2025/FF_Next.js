/**
 * InlineAddTech — inline form for creating a new technician without leaving
 * the PickTechStep flow. Validates SA mobile, populates contractor dropdown,
 * calls onCreated(tech) on success. Dark theme (bg-neutral-900/800).
 */

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { createTechnician, fetchContractors, ApiError } from '@/modules/field-stock-pwa/api';
import type { PwaTechSummary } from '@/modules/field-stock-pwa/types';

// ⚪ UNTESTED: no integration tests yet (Task 2.9)

/** Forgiving SA mobile pattern: +27XXXXXXXXX or 0XXXXXXXXX (9 digits after prefix) */
const SA_MOBILE_RE = /^(\+?27|0)\d{9}$/;

export interface InlineAddTechProps {
  onCreated: (tech: PwaTechSummary) => void;
  onCancel: () => void;
}

interface FormState {
  firstName: string;
  lastName: string;
  phone: string;
  contractorId: string;
}

interface FieldErrors {
  firstName?: string;
  lastName?: string;
  phone?: string;
}

const INPUT_CLS =
  'w-full px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-white placeholder:text-neutral-500 text-sm focus:outline-none focus:border-blue-500';

function TextField({
  label, type, value, onChange, error,
}: {
  label: string; type: string; value: string;
  onChange: (v: string) => void; error?: string;
}) {
  return (
    <div>
      <input type={type} placeholder={label} value={value}
        onChange={(e) => onChange(e.target.value)} className={INPUT_CLS} />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function validate(fields: FormState): FieldErrors {
  const errors: FieldErrors = {};
  if (!fields.firstName.trim()) errors.firstName = 'First name is required';
  if (!fields.lastName.trim()) errors.lastName = 'Last name is required';
  if (!fields.phone.trim()) {
    errors.phone = 'Phone number is required';
  } else if (!SA_MOBILE_RE.test(fields.phone.replace(/\s/g, ''))) {
    errors.phone = 'Enter a valid SA mobile number (e.g. 082 123 4567 or +27821234567)';
  }
  return errors;
}

export function InlineAddTech({ onCreated, onCancel }: InlineAddTechProps) {
  const [fields, setFields] = useState<FormState>({
    firstName: '',
    lastName: '',
    phone: '',
    contractorId: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [contractors, setContractors] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    fetchContractors()
      .then(setContractors)
      .catch(() => {
        // Non-fatal: contractor dropdown stays empty; field is optional
      });
  }, []);

  function setField(key: keyof FormState, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
    // Clear field error on change
    if (errors[key as keyof FieldErrors]) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const fieldErrors = validate(fields);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);
    try {
      const tech = await createTechnician({
        firstName: fields.firstName.trim(),
        lastName: fields.lastName.trim(),
        phone: fields.phone.replace(/\s/g, ''),
        contractorId: fields.contractorId || null,
      });
      onCreated(tech);
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        setSubmitError(err.message);
      } else {
        setSubmitError('Something went wrong. Please try again.');
      }
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-lg bg-neutral-900 border border-neutral-700 p-4 space-y-3"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold text-neutral-200">New technician</span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="text-neutral-500 hover:text-neutral-200"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <TextField label="First name *" type="text" value={fields.firstName}
        onChange={(v) => setField('firstName', v)} error={errors.firstName} />
      <TextField label="Last name *" type="text" value={fields.lastName}
        onChange={(v) => setField('lastName', v)} error={errors.lastName} />
      <TextField label="Phone * (e.g. 0821234567)" type="tel" value={fields.phone}
        onChange={(v) => setField('phone', v)} error={errors.phone} />

      <select
        value={fields.contractorId}
        onChange={(e) => setField('contractorId', e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-blue-500 text-white"
      >
        <option value="">Contractor (optional)</option>
        {contractors.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      {/* Submit error */}
      {submitError && (
        <div className="px-3 py-2 rounded-lg bg-red-950 border border-red-800 text-red-300 text-xs">
          {submitError}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 min-h-[44px] rounded-lg border border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500 text-sm disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 min-h-[44px] rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-medium text-sm disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create & select'}
        </button>
      </div>
    </form>
  );
}
