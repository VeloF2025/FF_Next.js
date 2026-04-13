/**
 * Client PO Create Modal
 * Form to create a new Client Purchase Order
 * Supports manual entry and PDF import via VLM extraction
 * WCAG 2.1 AA compliant - Task #239
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ClientPOCreateInput } from '@/types/finance';
import { log } from '@/lib/logger';
import type { POExtractionAPIResponse, POExtractionResult } from '@/modules/projects/types/po-extraction.types';
import { getConfidenceColorClass, getConfidenceLevel } from '@/modules/projects/types/po-extraction.types';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';

interface ClientPOCreateModalProps {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}

type TabType = 'manual' | 'import';

export function ClientPOCreateModal({ projectId, onClose, onCreated }: ClientPOCreateModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('manual');
  const [formData, setFormData] = useState<Partial<ClientPOCreateInput>>({
    poNumber: '',
    reference: '',
    contractedDrops: 0,
    pricePerDrop: 500,
    poDate: new Date().toISOString().split('T')[0],
    taxRate: 15,
    taxInclusive: false,
    description: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PDF Import state
  const [extracting, setExtracting] = useState(false);
  const [extractionResult, setExtractionResult] = useState<POExtractionResult | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [documentName, setDocumentName] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Accessibility refs
  const modalRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // FIX #1: ESC key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // FIX #2: Focus trap
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;

    const focusableElements = modal.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    modal.addEventListener('keydown', handleTabKey as EventListener);
    return () => modal.removeEventListener('keydown', handleTabKey as EventListener);
  }, [activeTab]); // Re-run when tab changes (different focusable elements)

  // FIX #4: Auto-focus first input on mount
  useEffect(() => {
    if (activeTab === 'manual') {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        firstInputRef.current?.focus();
      }, 100);
    }
  }, [activeTab]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.poNumber?.trim()) {
      setError('PO number is required');
      return;
    }
    if (!formData.contractedDrops || formData.contractedDrops <= 0) {
      setError('Contracted drops must be greater than 0');
      return;
    }
    if (!formData.pricePerDrop || formData.pricePerDrop <= 0) {
      setError('Price per drop must be greater than 0');
      return;
    }

    setLoading(true);
    try {
      // Include source document info if from PDF import
      const payload: ClientPOCreateInput = {
        ...formData as ClientPOCreateInput,
      };

      if (documentUrl && extractionResult) {
        payload.sourceDocumentUrl = documentUrl;
        payload.sourceDocumentName = documentName || undefined;
        payload.vlmExtractionData = extractionResult as unknown as Record<string, unknown>;
        payload.vlmConfidenceScore = extractionResult.confidence;
      }

      const response = await fetch(`/api/projects/${projectId}/client-pos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.message || 'Failed to create Client PO');
      }

      // Record VLM corrections for learning (non-blocking, via API to avoid server-side imports)
      if (extractionResult) {
        fetch('/api/vlm-learning/record-po-corrections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            extraction: extractionResult,
            formData: {
              poNumber: formData.poNumber,
              reference: formData.reference || undefined,
              poDate: formData.poDate,
              contractedDrops: formData.contractedDrops,
              pricePerDrop: formData.pricePerDrop,
            },
            context: {
              projectId,
              documentName: documentName || undefined,
              vlmConfidence: extractionResult.confidence,
            },
          }),
        }).catch((e) => log.debug('Non-blocking operation failed', { error: e instanceof Error ? e.message : 'unknown' }, 'projects')); // Non-blocking
      }

      onCreated();
    } catch (err) {
      log.error('Failed to create Client PO', { projectId, err });
      setError(err instanceof Error ? err.message : 'Failed to create Client PO');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = useCallback(async (file: File) => {
    if (!file.type.includes('pdf')) {
      setError('Please upload a PDF file');
      return;
    }

    setExtracting(true);
    setError(null);
    setExtractionResult(null);

    try {
      const formDataUpload = new FormData();
      formDataUpload.append('file', file);

      const response = await fetch(`/api/projects/${projectId}/client-pos/extract-from-pdf`, {
        method: 'POST',
        body: formDataUpload,
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.message || 'Failed to extract data from PDF');
      }

      const apiResult = await response.json();
      // API wraps response in { success, data }
      const result: POExtractionAPIResponse = apiResult.data || apiResult;

      if (!result.success || !result.extraction) {
        throw new Error(result.error || 'Extraction failed - no data returned');
      }

      // Store extraction info
      setExtractionResult(result.extraction);
      setDocumentUrl(result.documentUrl);
      setDocumentName(result.documentName);

      // Pre-populate form with extracted data
      setFormData(prev => ({
        ...prev,
        poNumber: result.extraction!.poNumber || prev.poNumber || '',
        reference: result.extraction!.reference || prev.reference || '',
        contractedDrops: result.extraction!.quantity || prev.contractedDrops || 0,
        pricePerDrop: result.extraction!.unitPrice || prev.pricePerDrop || 500,
        poDate: result.extraction!.poDate || prev.poDate || new Date().toISOString().split('T')[0],
        taxRate: result.extraction!.vatRate || prev.taxRate || 15,
        description: result.extraction!.description || prev.description || '',
      }));

      // Switch to manual tab to review/edit
      setActiveTab('manual');
    } catch (err) {
      log.error('PDF extraction failed', { projectId, err });
      setError(err instanceof Error ? err.message : 'Failed to extract data from PDF');
    } finally {
      setExtracting(false);
    }
  }, [projectId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileUpload(file);
    }
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  }, [handleFileUpload]);

  const subtotal = (formData.contractedDrops || 0) * (formData.pricePerDrop || 0);
  const vatAmount = subtotal * ((formData.taxRate || 15) / 100);
  const totalIncVat = subtotal + vatAmount;

  // Confidence indicator for extracted fields
  const renderConfidenceIndicator = () => {
    if (!extractionResult) return null;

    const level = getConfidenceLevel(extractionResult.confidence);
    const colorClass = getConfidenceColorClass(extractionResult.confidence);
    const percent = Math.round(extractionResult.confidence * 100);

    return (
      <div className={`p-3 rounded-lg border ${colorClass} mb-4`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {level === 'high' && '✓ High confidence extraction'}
            {level === 'medium' && '⚠ Review suggested'}
            {level === 'low' && '⚠ Manual verification needed'}
          </span>
          <span className="text-sm">{percent}%</span>
        </div>
        {documentName && (
          <div className="text-xs mt-1 opacity-75">
            Source: {documentName}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4" style={{ zIndex: 'var(--ff-z-modal-backdrop, 1040)' }}>
      <div
        ref={modalRef}
        className="bg-[var(--ff-bg-card)] rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto"
        style={{ zIndex: 'var(--ff-z-modal, 1050)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="sticky top-0 bg-[var(--ff-bg-card)] px-6 py-4 border-b border-[var(--ff-border-light)] flex items-center justify-between">
          <h2 id="modal-title" className="text-lg font-semibold text-[var(--ff-text-primary)]">Create Client PO</h2>
          {/* FIX #3: Close button already has aria-label ✓ */}
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close dialog"
            className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* FIX #8: Tab buttons with ARIA roles */}
        <div className="px-6 pt-4">
          <div className="flex border-b border-[var(--ff-border-light)]" role="tablist" aria-label="PO creation methods">
            <button
              role="tab"
              aria-selected={activeTab === 'manual'}
              aria-controls="manual-panel"
              id="manual-tab"
              onClick={() => setActiveTab('manual')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'manual'
                  ? 'border-[var(--ff-accent)] text-[var(--ff-accent)]'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              Manual Entry
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'import'}
              aria-controls="import-panel"
              id="import-tab"
              onClick={() => setActiveTab('import')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'import'
                  ? 'border-[var(--ff-accent)] text-[var(--ff-accent)]'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              Import from PDF
            </button>
          </div>
        </div>

        {/* Import Tab */}
        {activeTab === 'import' && (
          <div 
            id="import-panel"
            role="tabpanel"
            aria-labelledby="import-tab"
            className="p-6 bg-[var(--ff-bg-card)]"
          >
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload PO PDF file. Drag and drop or click to browse."
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragActive
                  ? 'border-[var(--ff-accent)] bg-[var(--ff-accent)]/10'
                  : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] hover:border-[var(--ff-text-secondary)]'
              }`}
            >
              {extracting ? (
                <div className="flex flex-col items-center">
                  <LoadingSpinner size="xl" className="mb-4" />
                  <p className="text-[var(--ff-text-secondary)]">Extracting data from PDF...</p>
                  <p className="text-xs text-[var(--ff-text-secondary)] mt-2">This may take up to 90 seconds</p>
                </div>
              ) : (
                <>
                  <svg className="w-12 h-12 mx-auto text-[var(--ff-text-secondary)] mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-[var(--ff-text-primary)] mb-2">
                    Drop your PO PDF here, or click to browse
                  </p>
                  <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
                    We&apos;ll extract PO details automatically using AI
                  </p>
                  {/* FIX #5: File input with htmlFor association */}
                  <label htmlFor="pdf-upload-input" className="inline-block">
                    <input
                      id="pdf-upload-input"
                      type="file"
                      accept=".pdf"
                      onChange={handleFileInput}
                      className="hidden"
                    />
                    <span className="px-4 py-2 bg-[var(--ff-accent)] hover:bg-[var(--ff-accent-hover)] text-white rounded-lg font-medium cursor-pointer transition-colors">
                      Select PDF
                    </span>
                  </label>
                </>
              )}
            </div>

            {/* FIX #6: Error with role="alert" and aria-live */}
            {error && (
              <div 
                role="alert" 
                aria-live="assertive"
                className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm"
              >
                {error}
              </div>
            )}

            <p className="text-xs text-[var(--ff-text-secondary)] mt-4">
              Supported: Fibertime PO format. The PDF will be stored with your Client PO.
            </p>
          </div>
        )}

        {/* Manual Entry Tab */}
        {activeTab === 'manual' && (
          <form 
            onSubmit={handleSubmit} 
            id="manual-panel"
            role="tabpanel"
            aria-labelledby="manual-tab"
            className="p-6 space-y-4"
          >
            {renderConfidenceIndicator()}

            {/* FIX #6: Error with role="alert" and aria-live */}
            {error && !extractionResult && (
              <div 
                role="alert" 
                aria-live="assertive"
                className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm"
              >
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                {/* FIX #7: Required fields with aria-required */}
                <label htmlFor="po-number" className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  PO Number *
                </label>
                <input
                  id="po-number"
                  ref={firstInputRef}
                  type="text"
                  value={formData.poNumber || ''}
                  onChange={(e) => setFormData({ ...formData, poNumber: e.target.value })}
                  aria-required="true"
                  required
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-[var(--ff-accent)]"
                  placeholder="PO-001"
                />
              </div>
              <div>
                <label htmlFor="client-reference" className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Client Reference
                </label>
                <input
                  id="client-reference"
                  type="text"
                  value={formData.reference || ''}
                  onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-[var(--ff-accent)]"
                  placeholder="MAM.POP2"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                {/* FIX #7: Required fields with aria-required */}
                <label htmlFor="contracted-drops" className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Contracted Drops *
                </label>
                <input
                  id="contracted-drops"
                  type="number"
                  value={formData.contractedDrops || ''}
                  onChange={(e) => setFormData({ ...formData, contractedDrops: parseInt(e.target.value) || 0 })}
                  aria-required="true"
                  required
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-[var(--ff-accent)]"
                  min="1"
                />
              </div>
              <div>
                {/* FIX #7: Required fields with aria-required */}
                <label htmlFor="price-per-drop" className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Price per Drop (R) *
                </label>
                <input
                  id="price-per-drop"
                  type="number"
                  value={formData.pricePerDrop || ''}
                  onChange={(e) => setFormData({ ...formData, pricePerDrop: parseFloat(e.target.value) || 0 })}
                  aria-required="true"
                  required
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-[var(--ff-accent)]"
                  min="0.01"
                  step="0.01"
                />
              </div>
            </div>

            <div className="p-4 bg-[var(--ff-accent)]/10 border border-[var(--ff-accent)]/30 rounded-lg space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-[var(--ff-text-secondary)]">Subtotal (excl. VAT)</span>
                <span className="text-lg font-semibold text-[var(--ff-text-primary)]">
                  R {subtotal.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-[var(--ff-text-secondary)]">VAT ({formData.taxRate || 15}%)</span>
                <span className="text-sm text-[var(--ff-text-secondary)]">
                  R {vatAmount.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-[var(--ff-accent)]/30">
                <span className="text-sm font-medium text-[var(--ff-text-primary)]">Total (incl. VAT)</span>
                <span className="text-xl font-bold text-[var(--ff-accent)]">
                  R {totalIncVat.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                {/* FIX #7: Required fields with aria-required */}
                <label htmlFor="po-date" className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  PO Date *
                </label>
                <input
                  id="po-date"
                  type="date"
                  value={formData.poDate || ''}
                  onChange={(e) => setFormData({ ...formData, poDate: e.target.value })}
                  aria-required="true"
                  required
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-[var(--ff-accent)]"
                />
              </div>
              <div>
                <label htmlFor="tax-rate" className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Tax Rate (%)
                </label>
                <input
                  id="tax-rate"
                  type="number"
                  value={formData.taxRate ?? 15}
                  onChange={(e) => setFormData({ ...formData, taxRate: parseFloat(e.target.value) || 15 })}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-[var(--ff-accent)]"
                  min="0"
                  max="100"
                  step="0.01"
                />
              </div>
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Description
              </label>
              <textarea
                id="description"
                value={formData.description || ''}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-[var(--ff-accent)] resize-none"
                placeholder="Additional details about this PO..."
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-[var(--ff-border-light)]">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-[var(--ff-accent)] hover:bg-[var(--ff-accent-hover)] disabled:bg-[var(--ff-accent)]/50 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {loading && (
                  <InlineSpinner size="sm" />
                )}
                Create Client PO
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
