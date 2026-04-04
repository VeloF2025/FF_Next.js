import React, { useState, useEffect, useCallback } from 'react';
import { Save, X } from 'lucide-react';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';
import { ProcurementErrorBoundary } from '../../components/error/ProcurementErrorBoundary';
import { BOQLineItemsTable, type BOQLineItemRow } from './BOQLineItemsTable';
import { BOQMetadataFields, BOQFileUpload, type BOQFormState } from './BOQFormFields';
import { log } from '@/lib/logger';
import type { BOQItem, BOQStatusType } from '@/types/procurement/boq.types';

interface BOQEditProps {
  boqId: string;
  projectId: string;
  onSave: (boqData: Partial<BOQItem>) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-300',
  mapping_review: 'bg-yellow-500/20 text-yellow-400',
  approved: 'bg-green-500/20 text-green-400',
  archived: 'bg-purple-500/20 text-purple-400',
  superseded: 'bg-red-500/20 text-red-400',
};

/**
 * BOQ Edit Form
 * Fetches existing BOQ data and allows editing metadata, file, and line items.
 */
export function BOQEdit({ boqId, projectId, onSave, onCancel, isLoading }: BOQEditProps) {
  const [form, setForm] = useState<BOQFormState>({
    name: '', version: '1.0', title: '', description: '', currency: 'ZAR',
  });
  const [status, setStatus] = useState<BOQStatusType>('draft');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [lineItems, setLineItems] = useState<BOQLineItemRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchBOQ() {
      try {
        const res = await fetch(`/api/procurement/boq/${boqId}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const data = json.data ?? json;
        if (cancelled) return;

        setForm({
          name: data.name ?? '',
          version: data.version ?? '1.0',
          title: data.title ?? '',
          description: data.description ?? '',
          currency: data.currency ?? 'ZAR',
        });
        setStatus(data.status ?? 'draft');

        if (Array.isArray(data.items)) {
          setLineItems(
            data.items.map((item: Record<string, unknown>, idx: number) => ({
              lineNumber: (item.lineNumber as number) ?? idx + 1,
              itemCode: (item.itemCode as string) ?? '',
              description: (item.description as string) ?? '',
              category: (item.category as string) ?? '',
              quantity: Number(item.quantity) || 0,
              uom: (item.uom as string) ?? 'EA',
              unitPrice: Number(item.unitPrice) || 0,
              totalPrice: Number(item.totalPrice) || 0,
            }))
          );
        }
        log.info('BOQ data loaded', { boqId, name: data.name }, 'BOQEdit');
      } catch (err) {
        log.error('Failed to fetch BOQ', { boqId, error: String(err) }, 'BOQEdit');
      } finally {
        if (!cancelled) setFetching(false);
      }
    }
    fetchBOQ();
    return () => { cancelled = true; };
  }, [boqId]);

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
      log.info('BOQ updated', { boqId, name: form.name, items: lineItems.length }, 'BOQEdit');
    } catch (err) {
      log.error('Failed to update BOQ', { boqId, error: String(err) }, 'BOQEdit');
    }
  };

  if (fetching) {
    return (
      <ProcurementErrorBoundary level="component">
        <LoadingSpinner className="py-20" size="lg" label="Loading BOQ..." />
      </ProcurementErrorBoundary>
    );
  }

  return (
    <ProcurementErrorBoundary level="component">
      <form onSubmit={handleSubmit} className="p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header with status badge */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Edit BOQ</h1>
              <span className={`inline-flex px-2.5 py-0.5 text-xs font-semibold rounded-full ${STATUS_COLORS[status] ?? STATUS_COLORS.draft}`}>
                {status.replace('_', ' ').toUpperCase()}
              </span>
            </div>
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
                Save Changes
              </button>
            </div>
          </div>

          <BOQMetadataFields values={form} onChange={handleField} errors={errors} />
          <BOQFileUpload selectedFile={selectedFile} onFileChange={setSelectedFile} label="Replace File" />

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
