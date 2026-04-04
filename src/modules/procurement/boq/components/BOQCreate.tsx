import React, { useState, useCallback } from 'react';
import { Save, X } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { ProcurementErrorBoundary } from '../../components/error/ProcurementErrorBoundary';
import { BOQLineItemsTable, type BOQLineItemRow } from './BOQLineItemsTable';
import { BOQMetadataFields, BOQFileUpload, type BOQFormState } from './BOQFormFields';
import { log } from '@/lib/logger';
import type { BOQItem } from '@/types/procurement/boq.types';

interface BOQCreateProps {
  projectId: string;
  onSave: (boqData: Partial<BOQItem>) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
}

/**
 * BOQ Create Form
 * Allows creating a new Bill of Quantities with metadata, file upload, and manual line items.
 */
export function BOQCreate({ projectId, onSave, onCancel, isLoading }: BOQCreateProps) {
  const [form, setForm] = useState<BOQFormState>({
    name: '', version: '1.0', title: '', description: '', currency: 'ZAR',
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [lineItems, setLineItems] = useState<BOQLineItemRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleField = (field: keyof BOQFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const validate = useCallback((): boolean => {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = 'BOQ name is required';
    if (lineItems.some((li) => !li.description.trim())) {
      next.lineItems = 'All line items require a description';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [form.name, lineItems]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    try {
      await onSave({
        projectId,
        description: form.name,
        category: form.title || undefined,
        quantity: lineItems.length,
        uom: form.currency,
      } as Partial<BOQItem>);
      log.info('BOQ created', { name: form.name, projectId, items: lineItems.length }, 'BOQCreate');
    } catch (err) {
      log.error('Failed to create BOQ', { error: String(err) }, 'BOQCreate');
    }
  };

  return (
    <ProcurementErrorBoundary level="component">
      <form onSubmit={handleSubmit} className="p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
              Create Bill of Quantities
            </h1>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md
                  border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)]
                  bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-hover)] transition-colors"
              >
                <X className="h-4 w-4" /> Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md
                  text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {isLoading ? (
                  <InlineSpinner size="sm" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save
              </button>
            </div>
          </div>

          <BOQMetadataFields values={form} onChange={handleField} errors={errors} />
          <BOQFileUpload selectedFile={selectedFile} onFileChange={setSelectedFile} />

          {/* Line Items */}
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-5">
            {errors.lineItems && <p className="mb-3 text-xs text-red-400">{errors.lineItems}</p>}
            <BOQLineItemsTable items={lineItems} onChange={setLineItems} />
          </div>
        </div>
      </form>
    </ProcurementErrorBoundary>
  );
}
