/**
 * Step1Requirements — Requisition creation form for the Procurement Workflow Wizard.
 * Items table is extracted into RequisitionItemsTable to respect the 300-line limit.
 * BOQ-aware: when a project with a BOQ is selected, each item row shows a BOQ/ad-hoc toggle.
 */

import { useState, useEffect } from 'react';
import { Loader2, AlertCircle, Calendar, Building2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RequisitionUrgency } from '@/types/procurement/requisition.types';
import type { WorkflowState } from '../useWorkflowState';
import { RequisitionItemsTable, type FormItem } from './RequisitionItemsTable';
import { loadStep1Draft, useStep1Draft } from './useStep1Draft';
import { log } from '@/lib/logger';
import type { BOQLineUtilization } from '@/types/procurement/boq-utilization.types';

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

interface CostCenterOption {
  id: string;
  code: string;
  name: string;
}

interface DepartmentOption {
  id: string;
  name: string;
}

type SpendType = 'project' | 'cost_centre';

export interface Step1RequirementsProps {
  state: WorkflowState;
  onComplete: (update: Partial<WorkflowState>) => void;
}

function makeItem(): FormItem {
  return {
    id: crypto.randomUUID(),
    itemType: 'adhoc',
    itemDescription: '',
    quantity: '',
    uom: 'units',
    estimatedUnitPrice: '',
  };
}

/** Step 1: Create a new purchase requisition. */
export function Step1Requirements({ state, onComplete }: Step1RequirementsProps) {
  const { saveDraft, clearDraft, lastSaved } = useStep1Draft();

  // Restore from draft if the step hasn't been submitted yet
  const draft = state.requisitionId ? null : loadStep1Draft();

  const [spendType, setSpendType] = useState<SpendType>(draft?.costCenterId ? 'cost_centre' : 'project');
  const [projectId, setProjectId] = useState(draft?.projectId ?? state.projectId ?? '');
  const [costCenterId, setCostCenterId] = useState(draft?.costCenterId ?? '');
  const [department, setDepartment] = useState(draft?.department ?? '');
  const [requiredDate, setRequiredDate] = useState(draft?.requiredDate ?? '');
  const [urgency, setUrgency] = useState<RequisitionUrgency>((draft?.urgency as RequisitionUrgency) ?? 'normal');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [items, setItems] = useState<FormItem[]>(draft?.items ?? [makeItem()]);

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [costCentres, setCostCentres] = useState<CostCenterOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingCC, setIsLoadingCC] = useState(true);
  const [boqLines, setBoqLines] = useState<BOQLineUtilization[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Load projects list
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

  // Load cost centres list
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/procurement/cost-centers?is_active=true&limit=200');
        const json = (await res.json()) as { success: boolean; data?: { items?: CostCenterOption[]; tree?: CostCenterOption[] } };
        if (json.success && json.data) {
          setCostCentres(json.data.items ?? json.data.tree ?? []);
        }
      } catch (err) {
        log.error('Failed to load cost centres', { err }, 'Step1Requirements');
      } finally {
        setIsLoadingCC(false);
      }
    };
    load();
  }, []);

  // Load departments list
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/departments?isActive=true');
        const json = (await res.json()) as { success: boolean; data?: DepartmentOption[] };
        if (json.success && json.data) setDepartments(json.data);
      } catch (err) {
        log.error('Failed to load departments', { err }, 'Step1Requirements');
      }
    };
    load();
  }, []);

  // Load BOQ utilization when project changes
  useEffect(() => {
    if (!projectId) {
      setBoqLines([]);
      return;
    }
    const load = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/boq-utilization`);
        const json = await res.json() as { success: boolean; data?: { lines: BOQLineUtilization[] } };
        if (json.success && json.data) {
          setBoqLines(json.data.lines);
        } else {
          setBoqLines([]);
        }
      } catch {
        setBoqLines([]);
      }
    };
    load();
  }, [projectId]);

  // Auto-save form to localStorage whenever any field changes
  useEffect(() => {
    if (state.requisitionId) return; // already submitted — don't overwrite cleared draft
    saveDraft({ projectId, costCenterId, department, requiredDate, urgency, notes, items });
  }, [projectId, costCenterId, department, requiredDate, urgency, notes, items, saveDraft, state.requisitionId]);

  const getMinDate = () => new Date().toISOString().split('T')[0];

  const handleClearDraft = () => {
    clearDraft();
    setSpendType('project');
    setProjectId('');
    setCostCenterId('');
    setDepartment('');
    setRequiredDate('');
    setUrgency('normal');
    setNotes('');
    setItems([makeItem()]);
  };

  const addItem = () => setItems((prev) => [...prev, makeItem()]);

  const removeItem = (index: number) => {
    if (items.length > 1) setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateItem = <K extends keyof FormItem>(index: number, field: K, value: FormItem[K]) => {
    setItems((prev) => prev.map((item, i) => {
      if (i !== index) return item;
      // When switching from BOQ to adhoc, clear BOQ fields
      if (field === 'itemType' && value === 'adhoc') {
        return { ...item, itemType: 'adhoc', boqItemId: undefined, itemCode: undefined };
      }
      // When switching from adhoc to BOQ, clear stock description
      if (field === 'itemType' && value === 'boq') {
        return { ...item, itemType: 'boq', itemDescription: '', itemCode: undefined, boqItemId: undefined };
      }
      return { ...item, [field]: value };
    }));
  };

  // Atomically patch description + uom when a stock item is selected
  const selectStock = (index: number, patch: { itemDescription: string; uom: string }) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  };

  // Atomically patch BOQ fields when a BOQ line is selected
  const selectBOQ = (
    index: number,
    patch: { boqItemId: string; itemDescription: string; itemCode: string; uom: string; quantity: number | '' }
  ) => {
    setItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? { ...item, boqItemId: patch.boqItemId, itemDescription: patch.itemDescription,
              itemCode: patch.itemCode, uom: patch.uom, quantity: patch.quantity }
          : item
      )
    );
  };

  const clearBOQ = (index: number) => {
    setItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? { ...item, boqItemId: undefined, itemDescription: '', itemCode: undefined, quantity: '' }
          : item
      )
    );
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    // Require cost allocation
    if (spendType === 'project' && !projectId) {
      errors.projectId = 'Please select a project';
    } else if (spendType === 'cost_centre' && !costCenterId) {
      errors.costCenterId = 'Please select a cost centre';
    }

    const validItems = items.filter(
      (item) => item.itemDescription.trim() && item.quantity !== '' && (item.quantity as number) > 0,
    );
    if (validItems.length === 0) errors.items = 'At least one valid item is required';

    items.forEach((item, i) => {
      const hasDesc = item.itemDescription.trim().length > 0;
      const hasQty = item.quantity !== '' && (item.quantity as number) > 0;
      const hasPrice = item.estimatedUnitPrice !== '' && (item.estimatedUnitPrice as number) > 0;
      const hasAnyField = hasDesc || hasQty || hasPrice || !!item.boqItemId;

      // Flag partially-filled rows — prevents silent drop at submit
      if (hasAnyField && !hasDesc) {
        errors[`item_${i}_description`] = 'Description is required';
      }
      if (hasAnyField && !hasQty) {
        errors[`item_${i}_quantity`] = 'Quantity is required';
      }

      if (hasDesc && item.itemDescription.length < 3)
        errors[`item_${i}_description`] = 'Description must be at least 3 characters';
      if (item.quantity !== '' && (item.quantity as number) <= 0)
        errors[`item_${i}_quantity`] = 'Quantity must be greater than 0';
      if (item.itemType === 'boq' && !item.boqItemId)
        errors[`item_${i}_description`] = 'Please select a BOQ line or switch to Ad-hoc';
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
        projectId: spendType === 'project' ? (projectId || undefined) : undefined,
        costCenterId: spendType === 'cost_centre' ? (costCenterId || undefined) : undefined,
        department: department || undefined,
        requiredDate: requiredDate || undefined,
        urgency,
        notes: notes || undefined,
        items: items
          .filter((item) => item.itemDescription.trim() && item.quantity !== '' && (item.quantity as number) > 0)
          .map((item) => ({
            itemDescription: item.itemDescription,
            itemCode: item.itemCode || undefined,
            quantity: item.quantity as number,
            uom: item.uom,
            estimatedUnitPrice:
              item.estimatedUnitPrice !== '' ? (item.estimatedUnitPrice as number) : undefined,
            boqItemId: item.boqItemId || undefined,
            itemType: item.itemType,
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
        clearDraft();
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
      {/* Draft status bar */}
      {lastSaved && !state.requisitionId && (
        <div className="flex items-center justify-between text-xs text-[var(--ff-text-tertiary)]">
          <span>Draft saved {lastSaved.toLocaleTimeString()}</span>
          <button type="button" onClick={handleClearDraft} className="hover:text-red-400 transition-colors">
            Clear draft
          </button>
        </div>
      )}

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

          {/* Spend allocation type toggle */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              Cost Allocation <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setSpendType('project'); setCostCenterId(''); }}
                className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                  spendType === 'project'
                    ? 'bg-purple-600/20 border-purple-500/50 text-purple-400'
                    : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)] text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]'
                }`}
              >
                <Building2 className="inline h-4 w-4 mr-2 -mt-0.5" />
                Project Spend
              </button>
              <button
                type="button"
                onClick={() => { setSpendType('cost_centre'); setProjectId(''); setBoqLines([]); }}
                className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                  spendType === 'cost_centre'
                    ? 'bg-blue-600/20 border-blue-500/50 text-blue-400'
                    : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)] text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]'
                }`}
              >
                <Building2 className="inline h-4 w-4 mr-2 -mt-0.5" />
                Operational / Cost Centre
              </button>
            </div>
          </div>

          {/* Project select — only when spendType === 'project' */}
          {spendType === 'project' && (
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Project <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  disabled={isLoadingProjects}
                  className={`w-full pl-10 pr-10 py-2 bg-[var(--ff-bg-tertiary)] border rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50 appearance-none ${
                    fieldErrors.projectId ? 'border-red-500/50' : 'border-[var(--ff-border-light)]'
                  }`}
                >
                  <option value="">Select a project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)] pointer-events-none" />
              </div>
              {fieldErrors.projectId && <p className="mt-1 text-xs text-red-400">{fieldErrors.projectId}</p>}
              {projectId && boqLines.length > 0 && (
                <p className="mt-1 text-xs text-purple-400">
                  {boqLines.length} BOQ lines available for this project
                </p>
              )}
            </div>
          )}

          {/* Cost centre select — only when spendType === 'cost_centre' */}
          {spendType === 'cost_centre' && (
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Cost Centre <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
                <select
                  value={costCenterId}
                  onChange={(e) => setCostCenterId(e.target.value)}
                  disabled={isLoadingCC}
                  className={`w-full pl-10 pr-10 py-2 bg-[var(--ff-bg-tertiary)] border rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 appearance-none ${
                    fieldErrors.costCenterId ? 'border-red-500/50' : 'border-[var(--ff-border-light)]'
                  }`}
                >
                  <option value="">Select a cost centre</option>
                  {costCentres.map((cc) => <option key={cc.id} value={cc.id}>{cc.code} — {cc.name}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)] pointer-events-none" />
              </div>
              {fieldErrors.costCenterId && <p className="mt-1 text-xs text-red-400">{fieldErrors.costCenterId}</p>}
              {costCentres.length === 0 && !isLoadingCC && (
                <p className="mt-1 text-xs text-amber-400">
                  No cost centres configured yet. Go to Procurement → Cost Centers to create them.
                </p>
              )}
            </div>
          )}

          {/* Department */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Department (Optional)
            </label>
            <div className="relative">
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-4 py-2 pr-10 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50 appearance-none"
              >
                <option value="">Select department</option>
                {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)] pointer-events-none" />
            </div>
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
        boqLines={boqLines}
        onAdd={addItem}
        onRemove={removeItem}
        onUpdate={updateItem}
        onSelectStock={selectStock}
        onSelectBOQ={selectBOQ}
        onClearBOQ={clearBOQ}
      />

      {/* Submit */}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            'Next: Choose Strategy'
          )}
        </Button>
      </div>
    </form>
  );
}
