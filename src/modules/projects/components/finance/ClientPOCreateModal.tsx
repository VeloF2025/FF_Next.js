/**
 * Client PO Create Modal
 * Form to create a new Client Purchase Order
 * Supports manual entry and PDF import via VLM extraction
 */

import { useState, useCallback } from 'react';
import type { ClientPOCreateInput } from '@/types/finance';
import { log } from '@/lib/logger';
import type { POExtractionAPIResponse, POExtractionResult } from '@/modules/projects/types/po-extraction.types';
import { getConfidenceColorClass, getConfidenceLevel, CONFIDENCE_THRESHOLDS } from '@/modules/projects/types/po-extraction.types';

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
        }).catch(() => {}); // Non-blocking
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--ff-bg-card)] rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[var(--ff-bg-card)] px-6 py-4 border-b border-[var(--ff-border-light)] flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Create Client PO</h2>
          <button
            onClick={onClose}
            className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab buttons */}
        <div className="px-6 pt-4">
          <div className="flex border-b border-[var(--ff-border-light)]">
            <button
              onClick={() => setActiveTab('manual')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'manual'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              Manual Entry
            </button>
            <button
              onClick={() => setActiveTab('import')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'import'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              Import from PDF
            </button>
          </div>
        </div>

        {/* Import Tab */}
        {activeTab === 'import' && (
          <div className="p-6 bg-[var(--ff-bg-card)]">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragActive
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] hover:border-[var(--ff-text-secondary)]'
              }`}
            >
              {extracting ? (
                <div className="flex flex-col items-center">
                  <svg className="w-12 h-12 animate-spin text-blue-500 mb-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <p className="text-[var(--ff-text-secondary)]">Extracting data from PDF...</p>
                  <p className="text-xs text-[var(--ff-text-secondary)] mt-2">This may take up to 90 seconds</p>
                </div>
              ) : (
                <>
                  <svg className="w-12 h-12 mx-auto text-[var(--ff-text-secondary)] mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-[var(--ff-text-primary)] mb-2">
                    Drop your PO PDF here, or click to browse
                  </p>
                  <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
                    We&apos;ll extract PO details automatically using AI
                  </p>
                  <label className="inline-block">
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={handleFileInput}
                      className="hidden"
                    />
                    <span className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium cursor-pointer transition-colors">
                      Select PDF
                    </span>
                  </label>
                </>
              )}
            </div>

            {error && (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
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
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {renderConfidenceIndicator()}

            {error && !extractionResult && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  PO Number *
                </label>
                <input
                  type="text"
                  value={formData.poNumber || ''}
                  onChange={(e) => setFormData({ ...formData, poNumber: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="PO-001"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Client Reference
                </label>
                <input
                  type="text"
                  value={formData.reference || ''}
                  onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="MAM.POP2"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Contracted Drops *
                </label>
                <input
                  type="number"
                  value={formData.contractedDrops || ''}
                  onChange={(e) => setFormData({ ...formData, contractedDrops: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  min="1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Price per Drop (R) *
                </label>
                <input
                  type="number"
                  value={formData.pricePerDrop || ''}
                  onChange={(e) => setFormData({ ...formData, pricePerDrop: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  min="0.01"
                  step="0.01"
                />
              </div>
            </div>

            <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg space-y-2">
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
              <div className="flex justify-between items-center pt-2 border-t border-blue-500/30">
                <span className="text-sm font-medium text-[var(--ff-text-primary)]">Total (incl. VAT)</span>
                <span className="text-xl font-bold text-blue-400">
                  R {totalIncVat.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  PO Date *
                </label>
                <input
                  type="date"
                  value={formData.poDate || ''}
                  onChange={(e) => setFormData({ ...formData, poDate: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Tax Rate (%)
                </label>
                <input
                  type="number"
                  value={formData.taxRate ?? 15}
                  onChange={(e) => setFormData({ ...formData, taxRate: parseFloat(e.target.value) || 15 })}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  min="0"
                  max="100"
                  step="0.01"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Description
              </label>
              <textarea
                value={formData.description || ''}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
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
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {loading && (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
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
