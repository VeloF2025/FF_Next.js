// 🟢 WORKING: Create Purchase Requisition Form
// PRD-050 Phase 2: Core Procurement
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';

import {
  FileInput,
  Plus,
  Trash2,
  ArrowLeft,
  Save,
  Loader2,
  AlertCircle,
  Calendar,
  Building2,
  ChevronDown,
} from 'lucide-react';
import type {
  CreateRequisitionForm,
  RequisitionUrgency,
} from '@/types/procurement/requisition.types';
import { log } from '@/lib/logger';

// UOM Options
const UOM_OPTIONS = [
  { value: 'units', label: 'Units' },
  { value: 'pcs', label: 'Pieces' },
  { value: 'meters', label: 'Meters' },
  { value: 'rolls', label: 'Rolls' },
  { value: 'boxes', label: 'Boxes' },
  { value: 'sets', label: 'Sets' },
  { value: 'liters', label: 'Liters' },
  { value: 'kg', label: 'Kilograms' },
];

// Urgency Options
const URGENCY_OPTIONS: { value: RequisitionUrgency; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'text-gray-400' },
  { value: 'normal', label: 'Normal', color: 'text-blue-400' },
  { value: 'high', label: 'High', color: 'text-orange-400' },
  { value: 'critical', label: 'Critical', color: 'text-red-400' },
];

interface FormItem {
  id: string;
  itemDescription: string;
  quantity: number | '';
  uom: string;
  estimatedUnitPrice: number | '';
  notes: string;
}

interface Project {
  id: string;
  name: string;
  project_code: string;
}

export default function NewRequisitionPage() {
  const router = useRouter();

  // Form state
  const [projectId, setProjectId] = useState<string>('');
  const [department, setDepartment] = useState('');
  const [requiredDate, setRequiredDate] = useState('');
  const [urgency, setUrgency] = useState<RequisitionUrgency>('normal');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<FormItem[]>([
    { id: crypto.randomUUID(), itemDescription: '', quantity: '', uom: 'units', estimatedUnitPrice: '', notes: '' },
  ]);

  // Projects & departments
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Load projects
  useEffect(() => {
    const loadProjects = async () => {
      try {
        const response = await fetch('/api/projects');
        const data = await response.json();
        if (data.success) {
          setProjects(data.data || []);
        }
      } catch (err) {
        log.error('Failed to load projects', err);
      } finally {
        setIsLoadingProjects(false);
      }
    };
    loadProjects();
  }, []);

  // Load departments
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/departments?isActive=true');
        const json = await res.json() as { success: boolean; data?: { id: string; name: string }[] };
        if (json.success && json.data) setDepartments(json.data);
      } catch (err) {
        log.error('Failed to load departments', err);
      }
    };
    load();
  }, []);

  // Calculate totals
  const calculateLineTotal = (quantity: number | '', unitPrice: number | ''): number => {
    if (quantity === '' || unitPrice === '' || unitPrice <= 0) return 0;
    return quantity * unitPrice;
  };

  const estimatedTotal = items.reduce((sum, item) => {
    return sum + calculateLineTotal(item.quantity, item.estimatedUnitPrice);
  }, 0);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 2,
    }).format(value);
  };

  // Item management
  const addItem = () => {
    setItems([
      ...items,
      { id: crypto.randomUUID(), itemDescription: '', quantity: '', uom: 'units', estimatedUnitPrice: '', notes: '' },
    ]);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const updateItem = (index: number, field: keyof FormItem, value: string | number) => {
    setItems(items.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  // Validation
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    // Validate items
    const validItems = items.filter(
      (item) => item.itemDescription.trim() && item.quantity !== '' && item.quantity > 0 && item.uom
    );

    if (validItems.length === 0) {
      errors.items = 'At least one valid item is required';
    }

    items.forEach((item, index) => {
      if (item.itemDescription.trim() && item.itemDescription.length < 3) {
        errors[`item_${index}_description`] = 'Description must be at least 3 characters';
      }
      if (item.quantity !== '' && item.quantity <= 0) {
        errors[`item_${index}_quantity`] = 'Quantity must be greater than 0';
      }
    });

    // Validate required date
    if (requiredDate) {
      const date = new Date(requiredDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (date < today) {
        errors.requiredDate = 'Required date cannot be in the past';
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Submit handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const payload: CreateRequisitionForm = {
        projectId: projectId || undefined,
        department: department || undefined,
        requiredDate: requiredDate || undefined,
        urgency,
        notes: notes || undefined,
        items: items
          .filter((item) => item.itemDescription.trim() && item.quantity !== '' && item.quantity > 0)
          .map((item) => ({
            itemDescription: item.itemDescription,
            quantity: item.quantity as number,
            uom: item.uom,
            estimatedUnitPrice: item.estimatedUnitPrice !== '' ? item.estimatedUnitPrice : undefined,
            notes: item.notes || undefined,
          })),
      };

      const response = await fetch('/api/procurement/requisitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (data.success) {
        router.push(`/procurement/requisitions/${data.data.id}`);
      } else {
        if (data.error?.details) {
          setFieldErrors(data.error.details);
        }
        setError(data.error?.message || 'Failed to create requisition');
      }
    } catch (err) {
      log.error('Failed to create requisition', err);
      setError('An error occurred while creating the requisition');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Get min date for date picker (today)
  const getMinDate = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => router.back()}
                  className="p-2 rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
                >
                  <ArrowLeft className="h-5 w-5 text-[var(--ff-text-secondary)]" />
                </button>
                <div className="p-2 rounded-lg bg-purple-500/20">
                  <FileInput className="h-6 w-6 text-purple-400" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">New Requisition</h1>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Create a purchase requisition</p>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 max-w-5xl mx-auto">
          {/* Error Banner */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
              <p className="text-red-400">{error}</p>
            </div>
          )}

          {/* Details Section */}
          <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6 mb-6">
            <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Requisition Details</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Project */}
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Project (Optional)
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
                  <select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="w-full pl-10 pr-10 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50 appearance-none"
                    disabled={isLoadingProjects}
                  >
                    <option value="">Select a project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)] pointer-events-none" />
                </div>
              </div>

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

              {/* Required Date */}
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
                  <p className="mt-1 text-sm text-red-400">{fieldErrors.requiredDate}</p>
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
                  {URGENCY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Notes - Full Width */}
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

          {/* Items Section */}
          <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-[var(--ff-text-primary)]">Items</h2>
              <button
                type="button"
                onClick={addItem}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add Item
              </button>
            </div>

            {fieldErrors.items && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-sm text-red-400">{fieldErrors.items}</p>
              </div>
            )}

            {/* Items Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--ff-border-light)]">
                    <th className="px-3 py-2 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                      Description *
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-24">
                      Qty *
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-28">
                      UOM *
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-32">
                      Unit Price (excl.)
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-32">
                      Line Total
                    </th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ff-border-light)]">
                  {items.map((item, index) => (
                    <tr key={item.id} className="group">
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={item.itemDescription}
                          onChange={(e) => updateItem(index, 'itemDescription', e.target.value)}
                          placeholder="Item description"
                          className="w-full px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                        />
                        {fieldErrors[`item_${index}_description`] && (
                          <p className="mt-1 text-xs text-red-400">{fieldErrors[`item_${index}_description`]}</p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateItem(index, 'quantity', e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="0"
                          min="0"
                          step="0.001"
                          className="w-full px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                        />
                        {fieldErrors[`item_${index}_quantity`] && (
                          <p className="mt-1 text-xs text-red-400">{fieldErrors[`item_${index}_quantity`]}</p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={item.uom}
                          onChange={(e) => updateItem(index, 'uom', e.target.value)}
                          className="w-full px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50 appearance-none"
                        >
                          {UOM_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--ff-text-tertiary)]">
                            R
                          </span>
                          <input
                            type="number"
                            value={item.estimatedUnitPrice}
                            onChange={(e) => updateItem(index, 'estimatedUnitPrice', e.target.value === '' ? '' : Number(e.target.value))}
                            placeholder="0.00"
                            min="0"
                            step="0.01"
                            className="w-full pl-7 pr-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="text-sm text-[var(--ff-text-primary)]">
                          {formatCurrency(calculateLineTotal(item.quantity, item.estimatedUnitPrice))}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(index)}
                            className="p-1.5 text-[var(--ff-text-tertiary)] hover:text-red-400 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary Section */}
          <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6 mb-6">
            <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Summary</h2>

            <div className="flex justify-between items-start">
              <div className="text-[var(--ff-text-secondary)]">
                <span className="font-medium">{items.filter((i) => i.itemDescription.trim()).length}</span> item(s)
              </div>
              <div className="text-right space-y-1">
                <div className="flex justify-between gap-8">
                  <span className="text-sm text-[var(--ff-text-tertiary)]">Subtotal (excl. VAT)</span>
                  <span className="text-sm text-[var(--ff-text-secondary)]">{formatCurrency(estimatedTotal)}</span>
                </div>
                <div className="flex justify-between gap-8">
                  <span className="text-sm text-[var(--ff-text-tertiary)]">VAT (15%)</span>
                  <span className="text-sm text-[var(--ff-text-secondary)]">{formatCurrency(Math.round(estimatedTotal * 0.15 * 100) / 100)}</span>
                </div>
                <div className="flex justify-between gap-8 border-t border-[var(--ff-border-light)] pt-1">
                  <span className="text-sm text-[var(--ff-text-tertiary)] font-medium">Total (incl. VAT)</span>
                  <span className="text-2xl font-semibold text-[var(--ff-text-primary)]">{formatCurrency(Math.round((estimatedTotal * 1.15) * 100) / 100)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
            >
              Cancel
            </button>
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
                <>
                  <Save className="h-4 w-4" />
                  Create Requisition
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}
