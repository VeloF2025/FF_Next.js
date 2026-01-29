/**
 * Number Sequences Section
 *
 * Configure document number prefixes, padding, and reset periods.
 * Shows a preview of the next number for each entity type.
 */

import { useState, useEffect, useCallback } from 'react';
import { Save, Loader2, AlertCircle, Hash } from 'lucide-react';

interface Sequence {
  id: string;
  entityType: string;
  prefix: string;
  nextNumber: number;
  padding: number;
  resetPeriod: string;
  preview: string;
}

const ENTITY_LABELS: Record<string, string> = {
  purchase_requisition: 'Purchase Requisition',
  purchase_order: 'Purchase Order',
  rfq: 'Request for Quotation',
  grn: 'Goods Receipt Note',
  quote: 'Quote Evaluation',
};

export function NumberSequencesSection() {
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/settings/procurement/sequences');
      const json = await res.json();
      if (json.success) {
        setSequences(json.data.sequences);
      } else {
        setError(json.error?.message || 'Failed to load');
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateSequence = (index: number, updates: Partial<Sequence>) => {
    setSequences(prev => {
      const next = [...prev];
      const seq = { ...next[index]!, ...updates };
      // Recalculate preview
      const yearPrefix = new Date().getFullYear().toString().slice(-2);
      seq.preview = `${seq.prefix}${yearPrefix}-${String(seq.nextNumber).padStart(seq.padding, '0')}`;
      next[index] = seq;
      return next;
    });
    setIsDirty(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings/procurement/sequences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequences: sequences.map(s => ({
            id: s.id,
            prefix: s.prefix,
            padding: s.padding,
            resetPeriod: s.resetPeriod,
          })),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setIsDirty(false);
      }
    } catch {
      setError('Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-[var(--ff-text-secondary)]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading sequences...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-4 text-red-400">
        <AlertCircle className="w-4 h-4" />
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--ff-border-light)]">
              <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium text-xs">Document Type</th>
              <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium text-xs">Prefix</th>
              <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium text-xs">Padding</th>
              <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium text-xs">Reset</th>
              <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium text-xs">Next Number</th>
              <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium text-xs">Preview</th>
            </tr>
          </thead>
          <tbody>
            {sequences.map((seq, idx) => (
              <tr key={seq.id} className="border-b border-[var(--ff-border-light)]">
                <td className="py-2 px-3">
                  <div className="flex items-center gap-2 text-[var(--ff-text-primary)]">
                    <Hash className="w-3.5 h-3.5 text-[var(--ff-text-tertiary)]" />
                    {ENTITY_LABELS[seq.entityType] || seq.entityType}
                  </div>
                </td>
                <td className="py-2 px-3">
                  <input
                    type="text"
                    value={seq.prefix}
                    onChange={e => updateSequence(idx, { prefix: e.target.value })}
                    className="w-20 px-2 py-1 text-sm rounded-md bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]"
                  />
                </td>
                <td className="py-2 px-3">
                  <select
                    value={seq.padding}
                    onChange={e => updateSequence(idx, { padding: parseInt(e.target.value) })}
                    className="px-2 py-1 text-sm rounded-md bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]"
                  >
                    {[3, 4, 5, 6].map(p => (
                      <option key={p} value={p}>{p} digits</option>
                    ))}
                  </select>
                </td>
                <td className="py-2 px-3">
                  <select
                    value={seq.resetPeriod}
                    onChange={e => updateSequence(idx, { resetPeriod: e.target.value })}
                    className="px-2 py-1 text-sm rounded-md bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]"
                  >
                    <option value="yearly">Yearly</option>
                    <option value="monthly">Monthly</option>
                    <option value="never">Never</option>
                  </select>
                </td>
                <td className="py-2 px-3 text-[var(--ff-text-secondary)]">
                  {seq.nextNumber}
                </td>
                <td className="py-2 px-3">
                  <code className="text-xs bg-[var(--ff-bg-tertiary)] px-2 py-1 rounded text-[var(--ff-primary-400)]">
                    {seq.preview}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isDirty && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-sm rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors flex items-center gap-1"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
        </div>
      )}
    </div>
  );
}
