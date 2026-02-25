/**
 * Step1Requirements — Requisition creation form for the Procurement Workflow Wizard.
 * Items table is extracted into RequisitionItemsTable to respect the 300-line limit.
 */

import { useState, useEffect } from 'react';
import { Loader2, AlertCircle, Calendar, Building2, ChevronDown } from 'lucide-react';
import type { RequisitionUrgency } from '@/types/procurement/requisition.types';
import type { WorkflowState } from '../useWorkflowState';
import { RequisitionItemsTable, type FormItem } from './RequisitionItemsTable';
import { log } from '@/lib/logger';
// calcTotal below is local and avoids importing the shared helper to keep concerns clear

// 🟢 WORKING: constants
const URGENCY_OPTIONS: { value: RequisitionUrgency; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

interface ProjectOption {
  id: string;
  name: string;
  project_code: string;
}

export interface Step1RequirementsProps {
  state: WorkflowState;
  onComplete: (update: Partial<WorkflowState>) => void;
}

function makeItem(): FormItem {
  return {
    id: crypto.randomUUID(),
    itemDescription: '',
    quantity: '',
    uom: 'units',
    estimatedUnitPrice: '',
  };
}

/** Step 1: Create a new purchase requisition. */
export function Step1Requirements({ state, onComplete }: Step1RequirementsProps) {
  const [projectId, setProjectId] = useState(state.projectId ?? '');
  const [department, setDepartment] = useState('');
  const [requiredDate, setRequiredDate] = useState('');
  const [urgency, setUrgency] = useState<RequisitionUrgency>('normal');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<FormItem[]>([makeItem()]);

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/projects');
        const json = (await res.json()) as { success: boolean; data?: ProjectOption[] };
        if (json.success) setProjects(json.data ?? []);
      } catch (err) {
        log.error('Failed to load projects', { err }, 'Step1Requirements');
      } finally {
        setIsLoadingProjects(false);
      }
    };
    load();
  }, []);

  const getMinDate = () => new Date().toISOString().split('T')[0];

  const addItem = () => setItems((prev) => [...prev, makeItem()]);

  const removeItem = (index: number) => {
    if (items.length > 1) setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateItem = <K extends keyof FormItem>(index: number, field: K, value: FormItem[K]) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  // Atomically patch description + uom when a stock item is selected
  const selectStock = (index: number, patch: { itemDescription: string; uom: string }) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    const validItems = items.filter(
      (item) => item.itemDescription.trim() && item.quantity !== '' && (item.quantity as number) > 0,
    );
    if (validItems.length === 0) errors.items = 'At least one valid item is required';

    items.forEach((item, i) => {
      if (item.itemDescription.trim() && item.itemDescription.length < 3)
        errors[`item_${i}_description`] = 'Description must be at least 3 characters';
      if (item.quantity !== '' && (item.quantity as number) <= 0)
        errors[`item_${i}_quantity`] = 'Quantity must be greater than 0';
    });

    if (requiredDate) {
      const d = new Date(requiredDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (d < today) errors.requiredDate = 'Required date cannot be in the past';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const calcTotal = () =>
    items.reduce((sum, { quantity: qty, estimatedUnitPrice: price }) => {
      const q = qty !== '' ? (qty as number) : 0;
      const p = price !== '' ? (price as number) : 0;
      return sum + (p > 0 ? q * p : 0);
    }, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const payload = {
        projectId: projectId || undefined,
        department: department || undefined,
        requiredDate: requiredDate || undefined,
        urgency,
        notes: notes || undefined,
        items: items
          .filter((item) => item.itemDescription.trim() && item.quantity !== '' && (item.quantity as number) > 0)
          .map((item) => ({
            itemDescription: item.itemDescription,
            quantity: item.quantity as number,
            uom: item.uom,
            estimatedUnitPrice:
              item.estimatedUnitPrice !== '' ? (item.estimatedUnitPrice as number) : undefined,
          })),
      };

      const res = await fetch('/api/procurement/requisitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as {
        success: boolean;
        data?: { id: string; requisitionNumber: string; estimatedTotal?: number };
        error?: { message: string; details?: Record<string, string> };
      };

      if (json.success && json.data) {
        const selectedProject = projects.find((p) => p.id === projectId);
        onComplete({
          requisitionId: json.data.id,
          requisitionNumber: json.data.requisitionNumber,
          estimatedTotal: json.data.estimatedTotal ?? calcTotal(),
          projectId: projectId || undefined,
          projectName: selectedProject?.name,
        });
      } else {
        if (json.error?.details) setFieldErrors(json.error.details);
        setError(json.error?.message ?? 'Failed to create requisition');
      }
    } catch (err) {
      log.error('Failed to create requisition', { err }, 'Step1Requirements');
      setError('An error occurred while creating the requisition');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Requisition details */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
        <h3 className="text-base font-medium text-[var(--ff-text-primary)] mb-4">Requisition Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Project select */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Project (Optional)
            </label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={isLoadingProjects}
                className="w-full pl-10 pr-10 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50 appearance-none"
              >
                <option value="">Select a project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)] pointer-events-none" />
            </div>
          </div>

          {/* Department */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Department (Optional)
            </label>
            <input
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g., Operations, Finance"
              maxLength={100}
              className="w-full px-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            />
          </div>

          {/* Required date */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Required By (Optional)
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="date"
                value={requiredDate}
                onChange={(e) => setRequiredDate(e.target.value)}
                min={getMinDate()}
                className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            </div>
            {fieldErrors.requiredDate && (
              <p className="mt-1 text-xs text-red-400">{fieldErrors.requiredDate}</p>
            )}
          </div>

          {/* Urgency */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Urgency</label>
            <select
              value={urgency}
              onChange={(e) => setUrgency(e.target.value as RequisitionUrgency)}
              className="w-full px-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50 appearance-none"
            >
              {URGENCY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>

          {/* Notes */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes or instructions..."
              rows={3}
              maxLength={1000}
              className="w-full px-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none"
            />
          </div>
        </div>
      </div>

      {/* Items table */}
      <RequisitionItemsTable
        items={items}
        fieldErrors={fieldErrors}
        onAdd={addItem}
        onRemove={removeItem}
        onUpdate={updateItem}
        onSelectStock={selectStock}
      />

      {/* Submit */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            'Next: Choose Strategy'
          )}
        </button>
      </div>
    </form>
  );
}
