'use client';

/**
 * Odoo Asset Import Wizard
 *
 * Multi-step wizard for importing assets from Odoo:
 * 1. Select categories to import
 * 2. Fleet filter (owned only checkbox)
 * 3. PO linking option
 * 4. Dry run preview
 * 5. Execute with progress
 *
 * Sprint 3: Asset-Procurement Integration
 */

import { useState, useCallback } from 'react';
import {
  Package,
  Truck,
  Link2,
  Eye,
  Play,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  X,
} from 'lucide-react';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';

// ============================================================================
// Types
// ============================================================================

interface AssetSyncDetail {
  source: 'product' | 'fleet';
  odooId: number;
  name: string;
  serialNumber?: string;
  action: 'created' | 'updated' | 'skipped' | 'error';
  linkedPoId?: string;
  linkedPoNumber?: string;
  message?: string;
}

interface AssetSyncResult {
  success: boolean;
  summary: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    linked: number;
    errors: number;
  };
  details: AssetSyncDetail[];
  errors: string[];
}

interface WizardStep {
  id: string;
  title: string;
  description: string;
  icon: typeof Package;
}

interface OdooImportWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: (result: AssetSyncResult) => void;
}

// ============================================================================
// Constants
// ============================================================================

const STEPS: WizardStep[] = [
  {
    id: 'categories',
    title: 'Select Categories',
    description: 'Choose which asset categories to import',
    icon: Package,
  },
  {
    id: 'fleet',
    title: 'Fleet Options',
    description: 'Configure vehicle import settings',
    icon: Truck,
  },
  {
    id: 'linking',
    title: 'PO Linking',
    description: 'Link assets to purchase orders',
    icon: Link2,
  },
  {
    id: 'preview',
    title: 'Preview',
    description: 'Review changes before import',
    icon: Eye,
  },
  {
    id: 'execute',
    title: 'Import',
    description: 'Execute the import',
    icon: Play,
  },
];

const CATEGORY_OPTIONS = [
  { id: 'tools', label: 'Tools', description: 'Hand tools, power tools, etc.' },
  { id: 'equipment', label: 'Equipment', description: 'Construction equipment' },
  { id: 'test equipment', label: 'Test Equipment', description: 'Splicers, meters, testers' },
  { id: 'safety', label: 'Safety Equipment', description: 'PPE, safety gear' },
];

// ============================================================================
// Component
// ============================================================================

export function OdooImportWizard({ isOpen, onClose, onComplete }: OdooImportWizardProps) {
  // Wizard state
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [selectedCategories, setSelectedCategories] = useState<string[]>(['tools', 'equipment']);
  const [includeFleet, setIncludeFleet] = useState(false);
  const [fleetOwnedOnly, setFleetOwnedOnly] = useState(true);
  const [linkPurchaseOrders, setLinkPurchaseOrders] = useState(true);

  // Results
  const [previewResult, setPreviewResult] = useState<AssetSyncResult | null>(null);
  const [importResult, setImportResult] = useState<AssetSyncResult | null>(null);

  // Reset wizard
  const resetWizard = useCallback(() => {
    setCurrentStep(0);
    setLoading(false);
    setError(null);
    setSelectedCategories(['tools', 'equipment']);
    setIncludeFleet(false);
    setFleetOwnedOnly(true);
    setLinkPurchaseOrders(true);
    setPreviewResult(null);
    setImportResult(null);
  }, []);

  // Close handler
  const handleClose = useCallback(() => {
    resetWizard();
    onClose();
  }, [onClose, resetWizard]);

  // Toggle category selection
  const toggleCategory = useCallback((categoryId: string) => {
    setSelectedCategories((prev) =>
      prev.includes(categoryId)
        ? prev.filter((c) => c !== categoryId)
        : [...prev, categoryId]
    );
  }, []);

  // Run preview
  const runPreview = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      selectedCategories.forEach((c) => params.append('categories', c));
      params.set('includeFleet', String(includeFleet));
      params.set('fleetOwnedOnly', String(fleetOwnedOnly));
      params.set('linkPurchaseOrders', String(linkPurchaseOrders));

      const response = await fetch(`/api/odoo/sync/assets?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Preview failed');
      }

      setPreviewResult(data.data);
      setCurrentStep(3); // Move to preview step
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  }, [selectedCategories, includeFleet, fleetOwnedOnly, linkPurchaseOrders]);

  // Execute import
  const executeImport = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/odoo/sync/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categories: selectedCategories,
          includeFleet,
          fleetOwnedOnly,
          linkPurchaseOrders,
          dryRun: false,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Import failed');
      }

      setImportResult(data.data);
      setCurrentStep(4); // Move to results step
      onComplete?.(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  }, [selectedCategories, includeFleet, fleetOwnedOnly, linkPurchaseOrders, onComplete]);

  // Navigation
  const canGoNext = useCallback(() => {
    switch (currentStep) {
      case 0:
        return selectedCategories.length > 0 || includeFleet;
      case 1:
        return true;
      case 2:
        return true;
      case 3:
        return previewResult !== null;
      default:
        return false;
    }
  }, [currentStep, selectedCategories, includeFleet, previewResult]);

  const goNext = useCallback(() => {
    if (currentStep === 2) {
      // Run preview when moving from linking to preview
      runPreview();
    } else if (currentStep === 3) {
      // Execute import when moving from preview to execute
      executeImport();
    } else if (currentStep < STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    }
  }, [currentStep, runPreview, executeImport]);

  const goBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  if (!isOpen) return null;

  const step = STEPS[currentStep]!;
  const StepIcon = step.icon;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-900 rounded-xl border border-slate-700 w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Package className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Import Assets from Odoo</h2>
              <p className="text-sm text-slate-400">Step {currentStep + 1} of {STEPS.length}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-4 py-2 border-b border-slate-700">
          <div className="flex gap-2">
            {STEPS.map((s, i) => (
              <div
                key={s.id}
                className={`flex-1 h-1 rounded-full transition-colors ${
                  i <= currentStep ? 'bg-blue-500' : 'bg-slate-700'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-slate-800 rounded-lg">
              <StepIcon className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h3 className="text-white font-medium">{step.title}</h3>
              <p className="text-sm text-slate-400">{step.description}</p>
            </div>
          </div>

          {/* Error display */}
          {error && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* Step 1: Categories */}
          {currentStep === 0 && (
            <div className="space-y-3">
              {CATEGORY_OPTIONS.map((cat) => (
                <label
                  key={cat.id}
                  className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                    selectedCategories.includes(cat.id)
                      ? 'bg-blue-500/10 border-blue-500'
                      : 'bg-slate-800 border-slate-700 hover:border-slate-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedCategories.includes(cat.id)}
                    onChange={() => toggleCategory(cat.id)}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
                  />
                  <div>
                    <p className="text-white font-medium">{cat.label}</p>
                    <p className="text-sm text-slate-400">{cat.description}</p>
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* Step 2: Fleet */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <label
                className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                  includeFleet
                    ? 'bg-blue-500/10 border-blue-500'
                    : 'bg-slate-800 border-slate-700 hover:border-slate-600'
                }`}
              >
                <input
                  type="checkbox"
                  checked={includeFleet}
                  onChange={(e) => setIncludeFleet(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
                />
                <div>
                  <p className="text-white font-medium">Include Fleet Vehicles</p>
                  <p className="text-sm text-slate-400">Import vehicles from Odoo fleet module</p>
                </div>
              </label>

              {includeFleet && (
                <label
                  className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-colors ml-6 ${
                    fleetOwnedOnly
                      ? 'bg-green-500/10 border-green-500'
                      : 'bg-slate-800 border-slate-700 hover:border-slate-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={fleetOwnedOnly}
                    onChange={(e) => setFleetOwnedOnly(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-green-500 focus:ring-green-500"
                  />
                  <div>
                    <p className="text-white font-medium">Company-Owned Only</p>
                    <p className="text-sm text-slate-400">
                      Exclude leased and rented vehicles (recommended)
                    </p>
                  </div>
                </label>
              )}
            </div>
          )}

          {/* Step 3: PO Linking */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <label
                className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                  linkPurchaseOrders
                    ? 'bg-blue-500/10 border-blue-500'
                    : 'bg-slate-800 border-slate-700 hover:border-slate-600'
                }`}
              >
                <input
                  type="checkbox"
                  checked={linkPurchaseOrders}
                  onChange={(e) => setLinkPurchaseOrders(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
                />
                <div>
                  <p className="text-white font-medium">Link to Purchase Orders</p>
                  <p className="text-sm text-slate-400">
                    Automatically link assets to matching POs for traceability
                  </p>
                </div>
              </label>

              <div className="p-4 bg-slate-800 rounded-lg">
                <h4 className="text-sm font-medium text-white mb-2">Matching Strategies</h4>
                <ul className="space-y-2 text-sm text-slate-400">
                  <li className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-green-400 rounded-full" />
                    <span><strong>High confidence:</strong> Serial number match in PO items</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-yellow-400 rounded-full" />
                    <span><strong>Medium confidence:</strong> Product name + date proximity (±30 days)</span>
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* Step 4: Preview */}
          {currentStep === 3 && (
            <div className="space-y-4">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <InlineSpinner size="lg" />
                  <span className="ml-3 text-slate-400">Generating preview...</span>
                </div>
              ) : previewResult ? (
                <>
                  {/* Summary cards */}
                  <div className="grid grid-cols-4 gap-3">
                    <div className="p-3 bg-slate-800 rounded-lg text-center">
                      <p className="text-2xl font-bold text-white">{previewResult.summary.total}</p>
                      <p className="text-xs text-slate-400">Total</p>
                    </div>
                    <div className="p-3 bg-green-900/30 border border-green-700 rounded-lg text-center">
                      <p className="text-2xl font-bold text-green-400">{previewResult.summary.created}</p>
                      <p className="text-xs text-slate-400">New</p>
                    </div>
                    <div className="p-3 bg-blue-900/30 border border-blue-700 rounded-lg text-center">
                      <p className="text-2xl font-bold text-blue-400">{previewResult.summary.updated}</p>
                      <p className="text-xs text-slate-400">Update</p>
                    </div>
                    <div className="p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg text-center">
                      <p className="text-2xl font-bold text-yellow-400">{previewResult.summary.linked}</p>
                      <p className="text-xs text-slate-400">PO Linked</p>
                    </div>
                  </div>

                  {/* Preview list */}
                  <div className="max-h-64 overflow-y-auto border border-slate-700 rounded-lg">
                    <table className="w-full">
                      <thead className="bg-slate-800 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs text-slate-400">Source</th>
                          <th className="px-3 py-2 text-left text-xs text-slate-400">Name</th>
                          <th className="px-3 py-2 text-left text-xs text-slate-400">Action</th>
                          <th className="px-3 py-2 text-left text-xs text-slate-400">PO Link</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700">
                        {previewResult.details.slice(0, 50).map((item, i) => (
                          <tr key={i} className="hover:bg-slate-800/50">
                            <td className="px-3 py-2">
                              <span className={`text-xs px-2 py-0.5 rounded ${
                                item.source === 'fleet' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
                              }`}>
                                {item.source}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-sm text-white">{item.name}</td>
                            <td className="px-3 py-2">
                              <span className={`text-xs px-2 py-0.5 rounded ${
                                item.action === 'created' ? 'bg-green-500/20 text-green-400' :
                                item.action === 'updated' ? 'bg-blue-500/20 text-blue-400' :
                                item.action === 'skipped' ? 'bg-slate-500/20 text-slate-400' :
                                'bg-red-500/20 text-red-400'
                              }`}>
                                {item.action}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-sm text-slate-400">
                              {item.linkedPoNumber || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {previewResult.details.length > 50 && (
                    <p className="text-sm text-slate-400 text-center">
                      Showing 50 of {previewResult.details.length} items
                    </p>
                  )}
                </>
              ) : null}
            </div>
          )}

          {/* Step 5: Execute/Results */}
          {currentStep === 4 && (
            <div className="space-y-4">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <InlineSpinner size="lg" />
                  <span className="ml-3 text-slate-400">Importing assets...</span>
                </div>
              ) : importResult ? (
                <>
                  {/* Success/Error banner */}
                  <div className={`p-4 rounded-lg flex items-center gap-3 ${
                    importResult.success
                      ? 'bg-green-900/30 border border-green-700'
                      : 'bg-yellow-900/30 border border-yellow-700'
                  }`}>
                    {importResult.success ? (
                      <CheckCircle2 className="w-6 h-6 text-green-400" />
                    ) : (
                      <AlertTriangle className="w-6 h-6 text-yellow-400" />
                    )}
                    <div>
                      <p className={`font-medium ${importResult.success ? 'text-green-400' : 'text-yellow-400'}`}>
                        {importResult.success ? 'Import Completed Successfully' : 'Import Completed with Errors'}
                      </p>
                      <p className="text-sm text-slate-400">
                        {importResult.summary.created} created, {importResult.summary.updated} updated
                        {importResult.summary.errors > 0 && `, ${importResult.summary.errors} errors`}
                      </p>
                    </div>
                  </div>

                  {/* Summary cards */}
                  <div className="grid grid-cols-5 gap-3">
                    <div className="p-3 bg-slate-800 rounded-lg text-center">
                      <p className="text-xl font-bold text-white">{importResult.summary.total}</p>
                      <p className="text-xs text-slate-400">Total</p>
                    </div>
                    <div className="p-3 bg-green-900/30 rounded-lg text-center">
                      <p className="text-xl font-bold text-green-400">{importResult.summary.created}</p>
                      <p className="text-xs text-slate-400">Created</p>
                    </div>
                    <div className="p-3 bg-blue-900/30 rounded-lg text-center">
                      <p className="text-xl font-bold text-blue-400">{importResult.summary.updated}</p>
                      <p className="text-xs text-slate-400">Updated</p>
                    </div>
                    <div className="p-3 bg-yellow-900/30 rounded-lg text-center">
                      <p className="text-xl font-bold text-yellow-400">{importResult.summary.linked}</p>
                      <p className="text-xs text-slate-400">Linked</p>
                    </div>
                    <div className="p-3 bg-red-900/30 rounded-lg text-center">
                      <p className="text-xl font-bold text-red-400">{importResult.summary.errors}</p>
                      <p className="text-xs text-slate-400">Errors</p>
                    </div>
                  </div>

                  {/* Errors list */}
                  {importResult.errors.length > 0 && (
                    <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg">
                      <p className="text-sm font-medium text-red-400 mb-2">Errors:</p>
                      <ul className="text-sm text-slate-400 space-y-1">
                        {importResult.errors.slice(0, 5).map((err, i) => (
                          <li key={i}>• {err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-slate-700">
          <button
            onClick={goBack}
            disabled={currentStep === 0 || loading}
            className="px-4 py-2 text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>

          <div className="flex items-center gap-3">
            {currentStep === 4 ? (
              <button
                onClick={handleClose}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
              >
                Done
              </button>
            ) : (
              <button
                onClick={goNext}
                disabled={!canGoNext() || loading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg font-medium flex items-center gap-2"
              >
                {loading && <InlineSpinner size="sm" />}
                {currentStep === 2 ? 'Preview' : currentStep === 3 ? 'Import Now' : 'Next'}
                {!loading && currentStep < 3 && <ChevronRight className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default OdooImportWizard;
