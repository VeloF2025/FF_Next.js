import React from 'react';
import { Upload } from 'lucide-react';
import { log } from '@/lib/logger';

const CURRENCY_OPTIONS = ['ZAR', 'USD', 'EUR', 'GBP'] as const;

const labelClass = 'block text-sm font-medium text-[var(--ff-text-secondary)] mb-1';
const inputClass =
  'w-full px-3 py-2 rounded-md border border-[var(--ff-border-light)] ' +
  'bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] text-sm ' +
  'focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none';

export interface BOQFormState {
  name: string;
  version: string;
  title: string;
  description: string;
  currency: string;
}

interface BOQFormFieldsProps {
  values: BOQFormState;
  onChange: (field: keyof BOQFormState, value: string) => void;
  errors: Record<string, string>;
}

/** Shared metadata fields for BOQ Create and Edit forms */
export function BOQMetadataFields({ values, onChange, errors }: BOQFormFieldsProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-5 space-y-4">
      <h2 className="text-sm font-semibold text-[var(--ff-text-primary)]">BOQ Details</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Name <span className="text-red-400">*</span></label>
          <input
            type="text"
            value={values.name}
            onChange={(e) => onChange('name', e.target.value)}
            className={`${inputClass} ${errors.name ? 'border-red-500' : ''}`}
            placeholder="e.g. Lawley Phase 1 BOQ"
          />
          {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
        </div>
        <div>
          <label className={labelClass}>Version</label>
          <input type="text" value={values.version} onChange={(e) => onChange('version', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Title</label>
          <input type="text" value={values.title} onChange={(e) => onChange('title', e.target.value)} className={inputClass} placeholder="Optional title" />
        </div>
        <div>
          <label className={labelClass}>Currency</label>
          <select value={values.currency} onChange={(e) => onChange('currency', e.target.value)} className={inputClass}>
            {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={labelClass}>Description</label>
        <textarea
          value={values.description}
          onChange={(e) => onChange('description', e.target.value)}
          rows={3}
          className={inputClass}
          placeholder="Optional description for this BOQ"
        />
      </div>
    </div>
  );
}

interface BOQFileUploadProps {
  selectedFile: File | null;
  onFileChange: (file: File | null) => void;
  label?: string;
}

/** File upload drop zone for BOQ forms */
export function BOQFileUpload({ selectedFile, onFileChange, label = 'Import from File' }: BOQFileUploadProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    onFileChange(file);
    if (file) {
      log.info('BOQ file selected', { fileName: file.name, size: file.size }, 'BOQFileUpload');
    }
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-5 space-y-3">
      <h2 className="text-sm font-semibold text-[var(--ff-text-primary)]">{label}</h2>
      <label className="flex flex-col items-center justify-center gap-2 py-8 border-2 border-dashed border-[var(--ff-border-light)] rounded-lg cursor-pointer hover:border-blue-500/50 transition-colors">
        <Upload className="h-8 w-8 text-[var(--ff-text-secondary)]" />
        <span className="text-sm text-[var(--ff-text-secondary)]">
          {selectedFile ? `File selected: ${selectedFile.name}` : 'Click to upload Excel or CSV'}
        </span>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleChange} className="hidden" />
      </label>
    </div>
  );
}
