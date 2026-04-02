/**
 * DevOps Section - DevOps-specific fields for FibreFlow application issues
 * // WORKING: Form section with screenshot-first VLM analysis + manual fields
 */

'use client';

import { Bug } from 'lucide-react';
import { type TicketFormData, type TicketFormErrors } from '../../../hooks/useTicketForm';
import { ScreenshotUploader } from './ScreenshotUploader';

interface DevOpsSectionProps {
  formData: TicketFormData;
  errors: TicketFormErrors;
  setField: <K extends keyof TicketFormData>(field: K, value: TicketFormData[K]) => void;
  setFields: (fields: Partial<TicketFormData>) => void;
  disabled?: boolean;
}

const FIBREFLOW_MODULES = [
  'Accounting',
  'Activate',
  'Assets',
  'Dashboard',
  'Data Sync',
  'Field Ops',
  'Fleet',
  'NOC',
  'Procurement',
  'Projects',
  'QField',
  'Reports',
  'Stock Portal',
  'Other',
] as const;

const ENVIRONMENTS: { value: string; label: string; color: string }[] = [
  { value: 'production', label: 'Production', color: 'bg-red-500/20 border-red-500 text-red-400' },
  { value: 'dev', label: 'Dev', color: 'bg-yellow-500/20 border-yellow-500 text-yellow-400' },
  { value: 'local', label: 'Local', color: 'bg-blue-500/20 border-blue-500 text-blue-400' },
];

export function DevOpsSection({ formData, errors, setField, setFields, disabled }: DevOpsSectionProps) {
  const handleFieldsExtracted = (fields: Record<string, string>) => {
    // Map VLM output to form fields (including title/description which live in DetailsSection)
    const mapped: Partial<TicketFormData> = {};
    if (fields.title) mapped.title = fields.title;
    if (fields.description) mapped.description = fields.description;
    if (fields.affected_module) mapped.affected_module = fields.affected_module;
    if (fields.environment) mapped.environment = fields.environment;
    if (fields.error_url) mapped.error_url = fields.error_url;
    if (fields.stack_trace) mapped.stack_trace = fields.stack_trace;
    if (fields.steps_to_reproduce) mapped.steps_to_reproduce = fields.steps_to_reproduce;
    if (fields.browser_info) mapped.browser_info = fields.browser_info;
    if (fields.priority_suggestion) {
      const priorityMap: Record<string, string> = {
        low: 'low', normal: 'normal', high: 'high', urgent: 'urgent', critical: 'critical',
      };
      const p = priorityMap[fields.priority_suggestion];
      if (p) mapped.priority = p as TicketFormData['priority'];
    }
    setFields(mapped);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-lg font-semibold text-[var(--ff-text-primary)]">
        <Bug className="w-5 h-5 text-purple-400" />
        DevOps Details
        <span className="text-xs font-normal text-purple-400 bg-purple-500/20 px-2 py-0.5 rounded-full">
          Application Issue
        </span>
      </div>

      {/* Screenshot Upload + VLM Analysis */}
      <ScreenshotUploader onFieldsExtracted={handleFieldsExtracted} disabled={disabled} />

      {/* Affected Module */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Affected Module
        </label>
        <select
          value={formData.affected_module}
          onChange={(e) => setField('affected_module', e.target.value)}
          disabled={disabled}
          className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          <option value="">Select module...</option>
          {FIBREFLOW_MODULES.map((mod) => (
            <option key={mod} value={mod}>
              {mod}
            </option>
          ))}
        </select>
        {errors.affected_module && (
          <p className="mt-1 text-sm text-red-400">{errors.affected_module}</p>
        )}
      </div>

      {/* Environment */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
          Environment
        </label>
        <div className="flex flex-wrap gap-2">
          {ENVIRONMENTS.map(({ value, label, color }) => {
            const isSelected = formData.environment === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setField('environment', value)}
                disabled={disabled}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  isSelected
                    ? color
                    : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:border-[var(--ff-border-medium)] hover:text-[var(--ff-text-primary)]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        {errors.environment && (
          <p className="mt-1 text-sm text-red-400">{errors.environment}</p>
        )}
      </div>

      {/* Error URL */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Error URL
          <span className="text-[var(--ff-text-muted)] font-normal ml-1">(Optional)</span>
        </label>
        <input
          type="text"
          value={formData.error_url}
          onChange={(e) => setField('error_url', e.target.value)}
          placeholder="https://app.fibreflow.app/noc/tickets/..."
          disabled={disabled}
          className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        {errors.error_url && (
          <p className="mt-1 text-sm text-red-400">{errors.error_url}</p>
        )}
      </div>

      {/* Steps to Reproduce */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Steps to Reproduce
          <span className="text-[var(--ff-text-muted)] font-normal ml-1">(Optional)</span>
        </label>
        <textarea
          value={formData.steps_to_reproduce}
          onChange={(e) => setField('steps_to_reproduce', e.target.value)}
          placeholder="1. Navigate to...&#10;2. Click on...&#10;3. Observe..."
          rows={4}
          disabled={disabled}
          className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 resize-none"
        />
        {errors.steps_to_reproduce && (
          <p className="mt-1 text-sm text-red-400">{errors.steps_to_reproduce}</p>
        )}
      </div>

      {/* Stack Trace */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Stack Trace / Error Message
          <span className="text-[var(--ff-text-muted)] font-normal ml-1">(Optional)</span>
        </label>
        <textarea
          value={formData.stack_trace}
          onChange={(e) => setField('stack_trace', e.target.value)}
          placeholder="Paste error message or stack trace here..."
          rows={6}
          disabled={disabled}
          className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 resize-y font-mono text-xs"
        />
        {errors.stack_trace && (
          <p className="mt-1 text-sm text-red-400">{errors.stack_trace}</p>
        )}
      </div>

      {/* Browser Info */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Browser / Device Info
          <span className="text-[var(--ff-text-muted)] font-normal ml-1">(Optional)</span>
        </label>
        <input
          type="text"
          value={formData.browser_info}
          onChange={(e) => setField('browser_info', e.target.value)}
          placeholder="Chrome 121 on Windows 11..."
          disabled={disabled}
          className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        {errors.browser_info && (
          <p className="mt-1 text-sm text-red-400">{errors.browser_info}</p>
        )}
      </div>
    </div>
  );
}
