/**
 * CreateFaultReportForm Component
 * Form for reporting a new equipment or material fault
 */

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { FaultTypeValue, FaultSeverityValue } from '@/types/procurement/fault.types';

interface CreateFaultReportFormProps {
  createFaultReport: (data: Record<string, unknown>) => Promise<boolean>;
  onSuccess: () => void;
  onCancel: () => void;
}

interface FormState {
  faultType: FaultTypeValue | '';
  severity: FaultSeverityValue | '';
  description: string;
  serialId: string;
  stockItemId: string;
  supplierId: string;
  projectId: string;
}

interface FormErrors {
  faultType?: string;
  severity?: string;
  description?: string;
}

const FAULT_TYPE_OPTIONS: { value: FaultTypeValue; label: string }[] = [
  { value: 'dead_on_arrival', label: 'Dead on Arrival' },
  { value: 'field_failure', label: 'Field Failure' },
  { value: 'physical_damage', label: 'Physical Damage' },
  { value: 'configuration_error', label: 'Configuration Error' },
  { value: 'unknown', label: 'Unknown' },
];

const SEVERITY_OPTIONS: { value: FaultSeverityValue; label: string; description: string }[] = [
  { value: 'minor', label: 'Minor', description: 'Minor defect, workaround available' },
  { value: 'major', label: 'Major', description: 'Significant fault, impacts performance' },
  { value: 'critical', label: 'Critical', description: 'Total failure, immediate action required' },
];

const initialFormState: FormState = {
  faultType: '',
  severity: '',
  description: '',
  serialId: '',
  stockItemId: '',
  supplierId: '',
  projectId: '',
};

export function CreateFaultReportForm({
  createFaultReport,
  onSuccess,
  onCancel,
}: CreateFaultReportFormProps) {
  const [form, setForm] = useState<FormState>(initialFormState);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validate = (): boolean => {
    const newErrors: FormErrors = {};
    if (!form.faultType) newErrors.faultType = 'Fault type is required';
    if (!form.severity) newErrors.severity = 'Severity is required';
    if (!form.description.trim()) newErrors.description = 'Description is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setSubmitError(null);

    const payload: Record<string, unknown> = {
      faultType: form.faultType,
      severity: form.severity,
      description: form.description.trim(),
    };

    if (form.serialId.trim()) payload.serialId = form.serialId.trim();
    if (form.stockItemId.trim()) payload.stockItemId = form.stockItemId.trim();
    if (form.supplierId.trim()) payload.supplierId = form.supplierId.trim();
    if (form.projectId.trim()) payload.projectId = form.projectId.trim();

    const success = await createFaultReport(payload);
    setSubmitting(false);

    if (success) {
      onSuccess();
    } else {
      setSubmitError('Failed to submit fault report. Please try again.');
    }
  };

  const field = (key: keyof FormState) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value })),
  });

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-lg bg-red-500/10 p-2">
          <AlertTriangle className="h-5 w-5 text-red-500" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Report Fault</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Report a defective or damaged item
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Fault Type */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Fault Type <span className="text-red-500">*</span>
          </label>
          <select
            {...field('faultType')}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            <option value="">Select fault type...</option>
            {FAULT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {errors.faultType && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.faultType}</p>
          )}
        </div>

        {/* Severity */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Severity <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-3 gap-3">
            {SEVERITY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer flex-col rounded-lg border p-3 transition-colors ${
                  form.severity === opt.value
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700'
                }`}
              >
                <input
                  type="radio"
                  name="severity"
                  value={opt.value}
                  checked={form.severity === opt.value}
                  onChange={() => setForm((prev) => ({ ...prev, severity: opt.value }))}
                  className="sr-only"
                />
                <span className="text-sm font-medium text-gray-900 dark:text-white">{opt.label}</span>
                <span className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{opt.description}</span>
              </label>
            ))}
          </div>
          {errors.severity && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.severity}</p>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Description <span className="text-red-500">*</span>
          </label>
          <textarea
            {...field('description')}
            rows={4}
            placeholder="Describe the fault in detail..."
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500"
          />
          {errors.description && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.description}</p>
          )}
        </div>

        {/* Optional Fields */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Serial ID <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              {...field('serialId')}
              placeholder="UUID of the serial record"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Stock Item ID <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              {...field('stockItemId')}
              placeholder="UUID of the stock item"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Supplier ID <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              {...field('supplierId')}
              placeholder="UUID of the supplier"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Project ID <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              {...field('projectId')}
              placeholder="UUID of the project"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500"
            />
          </div>
        </div>

        {/* Submit Error */}
        {submitError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {submitError}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Report Fault'}
          </button>
        </div>
      </form>
    </div>
  );
}
