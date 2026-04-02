/**
 * Quote Scanner Modal
 *
 * Modal for uploading and scanning supplier quote documents
 * Uses VLM to extract quote data and match to RFQ items
 *
 * Status: WORKING - OCR Quote Scanner Feature
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  FileText,
  Upload,
  X,
  Loader2,
  CheckCircle,
  AlertTriangle,
  FileImage,
  Trash2,
} from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import type {
  QuoteExtractionResult,
  QuoteMatchingResult,
  ExtractQuoteResponse,
} from '../types/extraction.types';

// ============================================================================
// TYPES
// ============================================================================

interface QuoteScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  rfqId?: string;
  rfqNumber?: string;
  onExtractionComplete: (
    extraction: QuoteExtractionResult,
    matching?: QuoteMatchingResult,
    extractionId?: string
  ) => void;
}

type ModalStep = 'upload' | 'processing' | 'review' | 'complete' | 'error';

// ============================================================================
// COMPONENT
// ============================================================================

export function QuoteScannerModal({
  isOpen,
  onClose,
  projectId,
  rfqId,
  rfqNumber,
  onExtractionComplete,
}: QuoteScannerModalProps) {
  const [step, setStep] = useState<ModalStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractQuoteResponse | null>(null);
  const [isCreatingQuote, setIsCreatingQuote] = useState(false);
  const [quoteCreated, setQuoteCreated] = useState(false);

  // Editable extraction data for review step
  const [editableData, setEditableData] = useState<{
    supplierName: string;
    quoteNumber: string;
    quoteDate: string;
    validUntil: string;
    subtotal: string;
    vatAmount: string;
    total: string;
    currency: string;
    paymentTerms: string;
    deliveryTerms: string;
  }>({
    supplierName: '',
    quoteNumber: '',
    quoteDate: '',
    validUntil: '',
    subtotal: '',
    vatAmount: '',
    total: '',
    currency: 'ZAR',
    paymentTerms: '',
    deliveryTerms: '',
  });

  // Supplier selection state
  const [existingSuppliers, setExistingSuppliers] = useState<Array<{ id: string; name: string; company_name: string }>>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('new'); // 'new' or supplier ID
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(false);
  const [matchedSupplier, setMatchedSupplier] = useState<{ id: string; name: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const prevIsOpenRef = useRef(false);

  // Reset state when modal opens (not when it closes)
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      // Modal just opened - reset to initial state
      setStep('upload');
      setFile(null);
      setPreviewUrl(null);
      setProgress(0);
      setError(null);
      setResult(null);
      setIsProcessing(false);
      setIsCreatingQuote(false);
      setQuoteCreated(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]);

  // Handle file selection
  const handleFileSelect = useCallback((selectedFile: File) => {
    // Validate file type
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!validTypes.includes(selectedFile.type)) {
      setError('Please upload a PDF or image file (JPEG, PNG)');
      return;
    }

    // Validate file size (20MB max)
    if (selectedFile.size > 20 * 1024 * 1024) {
      setError('File size must be less than 20MB');
      return;
    }

    setFile(selectedFile);
    setError(null);

    // Create preview for images
    if (selectedFile.type.startsWith('image/')) {
      const url = URL.createObjectURL(selectedFile);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  }, []);

  // Handle file input change
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  }, [handleFileSelect]);

  // Handle drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Clear selected file
  const handleClearFile = useCallback(() => {
    setFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [previewUrl]);

  // Process document
  const handleExtract = useCallback(async () => {
    if (!file) return;

    setIsProcessing(true);
    setStep('processing');
    setProgress(10);
    setError(null);

    try {
      // Create form data
      const formData = new FormData();
      formData.append('document', file);
      formData.append('projectId', projectId);
      if (rfqId) {
        formData.append('rfqId', rfqId);
      }

      setProgress(30);

      // Call API
      const response = await fetch('/api/procurement/quotes/extract-from-document', {
        method: 'POST',
        body: formData,
      });

      setProgress(70);

      const responseData = await response.json();

      // API wraps response in data property
      const data = responseData.data || responseData;

      if (!response.ok || !responseData.success) {
        throw new Error(data.message || responseData.error?.message || 'Extraction failed');
      }

      setProgress(100);
      setResult(data);

      // Populate editable data from extraction (with null safety)
      const extraction = data.extraction || {};
      setEditableData({
        supplierName: extraction.supplier?.name || '',
        quoteNumber: extraction.quoteInfo?.quoteNumber || '',
        quoteDate: extraction.quoteInfo?.quoteDate || new Date().toISOString().split('T')[0],
        validUntil: extraction.quoteInfo?.validUntil || '',
        subtotal: extraction.totals?.subtotal?.toString() || '',
        vatAmount: extraction.totals?.vatAmount?.toString() || '',
        total: extraction.totals?.total?.toString() || '',
        currency: extraction.totals?.currency || 'ZAR',
        paymentTerms: extraction.quoteInfo?.paymentTerms || '',
        deliveryTerms: extraction.quoteInfo?.deliveryTerms || '',
      });

      // Fetch suppliers and check for matches
      setIsLoadingSuppliers(true);
      try {
        const suppliersRes = await fetch('/api/suppliers?limit=500&status=active');
        if (suppliersRes.ok) {
          const suppliersData = await suppliersRes.json();
          // API returns { data: [...suppliers...] } directly
          const suppliers = Array.isArray(suppliersData.data)
            ? suppliersData.data
            : (suppliersData.data?.suppliers || suppliersData.suppliers || []);
          setExistingSuppliers(suppliers);

          // Try to find matching supplier - simple contains check
          const extractedName = (extraction.supplier?.name || '').toLowerCase().trim();
          if (extractedName && suppliers.length > 0) {
            // Normalize: remove PTY, LTD, CC, etc. for comparison
            const normalize = (name: string) => name
              .toLowerCase()
              .replace(/\(pty\)|pty|ltd|limited|inc|corp|cc|\.|,/gi, '')
              .replace(/\s+/g, ' ')
              .trim();

            const normalizedExtracted = normalize(extractedName);

            // Find best match by checking if names contain each other
            const match = suppliers.find((s: any) => {
              const supplierName = normalize(s.company_name || s.name || '');
              if (!supplierName) return false;

              // Check for substring match (either direction)
              return normalizedExtracted.includes(supplierName) ||
                     supplierName.includes(normalizedExtracted);
            });

            if (match) {
              setMatchedSupplier({ id: match.id, name: match.company_name || match.name });
              setSelectedSupplierId(match.id);
            }
          }
        }
      } catch (e) {
        // Ignore supplier fetch errors
      } finally {
        setIsLoadingSuppliers(false);
      }

      // Go to review step
      setStep('review');

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to extract quote data';
      setError(errorMsg);
      setStep('error');
    } finally {
      setIsProcessing(false);
    }
  }, [file, projectId, rfqId, onExtractionComplete]);

  // Reset modal
  const handleReset = useCallback(() => {
    setStep('upload');
    setFile(null);
    setPreviewUrl(null);
    setProgress(0);
    setError(null);
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // Handle close - don't reset here, we reset on open
  const handleClose = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    onClose();
  }, [previewUrl, onClose]);

  // Handle creating quote from extraction with user-edited data
  const handleCreateQuote = useCallback(async () => {
    if (!result?.extractionId) return;

    // Validate required fields
    if (selectedSupplierId === 'new' && !editableData.supplierName?.trim()) {
      setError('Supplier name is required when creating a new supplier');
      return;
    }
    if (!editableData.total || parseFloat(editableData.total) <= 0) {
      setError('Total amount is required');
      return;
    }

    setIsCreatingQuote(true);
    setError(null);
    try {
      const response = await fetch('/api/procurement/quotes/create-from-extraction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          extractionId: result.extractionId,
          // Pass existing supplier ID if selected
          supplierId: selectedSupplierId !== 'new' ? selectedSupplierId : undefined,
          // Override with user-edited data
          overrides: {
            supplierName: selectedSupplierId === 'new' ? editableData.supplierName.trim() : undefined,
            quoteNumber: editableData.quoteNumber?.trim() || undefined,
            quoteDate: editableData.quoteDate || undefined,
            validUntil: editableData.validUntil || undefined,
            subtotal: editableData.subtotal ? parseFloat(editableData.subtotal) : undefined,
            vatAmount: editableData.vatAmount ? parseFloat(editableData.vatAmount) : undefined,
            total: parseFloat(editableData.total),
            currency: editableData.currency || 'ZAR',
            paymentTerms: editableData.paymentTerms?.trim() || undefined,
            deliveryTerms: editableData.deliveryTerms?.trim() || undefined,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to create quote');
      }

      setQuoteCreated(true);
      setStep('complete');

      // Notify parent
      onExtractionComplete(result.extraction, result.matching, result.extractionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create quote');
    } finally {
      setIsCreatingQuote(false);
    }
  }, [result, editableData, selectedSupplierId, onExtractionComplete]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop - don't close during processing */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={step === 'processing' ? undefined : handleClose}
      />

      {/* Modal */}
      <div className="relative bg-card rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Scan Quote Document
              </h2>
              {rfqNumber && (
                <p className="text-sm text-muted-foreground">
                  Matching to {rfqNumber}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'upload' && (
            <div className="space-y-6">
              {/* Drop Zone */}
              <div
                ref={dropZoneRef}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                className={`
                  relative border-2 border-dashed rounded-lg p-8 text-center transition-colors
                  ${file
                    ? 'border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/20'
                    : 'border-border hover:border-blue-400 dark:hover:border-blue-500'
                  }
                `}
              >
                {!file ? (
                  <>
                    <Upload className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <p className="text-lg font-medium text-muted-foreground mb-2">
                      Drop your quote document here
                    </p>
                    <p className="text-sm text-muted-foreground mb-4">
                      or click to browse
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Select File
                    </Button>
                    <p className="text-xs text-gray-400 dark:text-muted-foreground mt-4">
                      Supports PDF, JPEG, PNG (max 20MB)
                    </p>
                  </>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt="Preview"
                          className="w-20 h-20 object-cover rounded-lg"
                        />
                      ) : (
                        <div className="w-20 h-20 bg-secondary rounded-lg flex items-center justify-center">
                          <FileImage className="h-10 w-10 text-gray-400" />
                        </div>
                      )}
                      <div className="text-left">
                        <p className="font-medium text-foreground">
                          {file.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleClearFile}
                      className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                    >
                      <Trash2 className="h-5 w-5 text-red-500" />
                    </button>
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf"
                  onChange={handleInputChange}
                  className="hidden"
                />
              </div>

              {/* Error Message */}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}

              {/* Info */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <h4 className="font-medium text-blue-800 dark:text-blue-300 mb-2">
                  How it works
                </h4>
                <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-1">
                  <li>• Upload a supplier quote (PDF or photo)</li>
                  <li>• AI extracts supplier info, line items, and totals</li>
                  <li>• Items are automatically matched to your RFQ</li>
                  <li>• Review and confirm before creating the quote</li>
                </ul>
              </div>
            </div>
          )}

          {step === 'processing' && (
            <div className="text-center py-12">
              <Loader2 className="h-16 w-16 mx-auto text-blue-500 animate-spin mb-6" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                Analyzing Document
              </h3>
              <p className="text-muted-foreground mb-6">
                Extracting quote data using AI...
              </p>

              {/* Progress Bar */}
              <div className="w-full max-w-xs mx-auto bg-secondary rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-sm text-gray-400 mt-2">{progress}%</p>
            </div>
          )}

          {step === 'review' && result && (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <h3 className="text-lg font-medium text-foreground">
                  Review Extracted Data
                </h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Please review and correct any errors before creating the quote.
              </p>

              {/* Document Preview */}
              {previewUrl && (
                <div className="mb-4 p-2 bg-secondary rounded-lg">
                  <img
                    src={previewUrl}
                    alt="Document"
                    className="max-h-40 mx-auto rounded"
                  />
                </div>
              )}

              {/* Supplier Selection */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
                <h4 className="font-medium text-blue-800 dark:text-blue-300 mb-2">
                  Supplier: {editableData.supplierName || 'Not detected'}
                </h4>

                {matchedSupplier && (
                  <div className="flex items-center gap-2 mb-3 p-2 bg-green-100 dark:bg-green-900/30 rounded">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="text-sm text-green-700 dark:text-green-400">
                      Found matching supplier: <strong>{matchedSupplier.name}</strong>
                    </span>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="supplierChoice"
                      value="new"
                      checked={selectedSupplierId === 'new'}
                      onChange={() => setSelectedSupplierId('new')}
                      className="text-blue-600"
                    />
                    <span className="text-sm text-muted-foreground">
                      Create new supplier: <strong>{editableData.supplierName || '(enter name below)'}</strong>
                    </span>
                  </label>

                  {existingSuppliers.length > 0 && (
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="supplierChoice"
                        value="existing"
                        checked={selectedSupplierId !== 'new'}
                        onChange={() => setSelectedSupplierId(matchedSupplier?.id || existingSuppliers[0]?.id || 'new')}
                        className="text-blue-600"
                      />
                      <span className="text-sm text-muted-foreground">
                        Link to existing supplier:
                      </span>
                      <select
                        value={selectedSupplierId !== 'new' ? selectedSupplierId : ''}
                        onChange={(e) => setSelectedSupplierId(e.target.value)}
                        disabled={selectedSupplierId === 'new'}
                        className="flex-1 px-2 py-1 text-sm rounded border border-border bg-card text-foreground disabled:opacity-50"
                      >
                        <option value="">Select supplier...</option>
                        {existingSuppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.company_name || s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>

                {selectedSupplierId === 'new' && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-muted-foreground mb-1">
                      New Supplier Name *
                    </label>
                    <input
                      type="text"
                      value={editableData.supplierName}
                      onChange={(e) => setEditableData(prev => ({ ...prev, supplierName: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground"
                      placeholder="Enter supplier name"
                    />
                  </div>
                )}

                {isLoadingSuppliers && (
                  <p className="text-xs text-muted-foreground mt-2">Loading suppliers...</p>
                )}
              </div>

              {/* Editable Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Quote Number *
                  </label>
                  <input
                    type="text"
                    value={editableData.quoteNumber}
                    onChange={(e) => setEditableData(prev => ({ ...prev, quoteNumber: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground"
                    placeholder="QUO-001"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Quote Date
                  </label>
                  <input
                    type="date"
                    value={editableData.quoteDate}
                    onChange={(e) => setEditableData(prev => ({ ...prev, quoteDate: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Valid Until
                  </label>
                  <input
                    type="date"
                    value={editableData.validUntil}
                    onChange={(e) => setEditableData(prev => ({ ...prev, validUntil: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Currency
                  </label>
                  <select
                    value={editableData.currency}
                    onChange={(e) => setEditableData(prev => ({ ...prev, currency: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground"
                  >
                    <option value="ZAR">ZAR</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Subtotal
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={editableData.subtotal}
                    onChange={(e) => setEditableData(prev => ({ ...prev, subtotal: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    VAT Amount
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={editableData.vatAmount}
                    onChange={(e) => setEditableData(prev => ({ ...prev, vatAmount: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Total *
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={editableData.total}
                    onChange={(e) => setEditableData(prev => ({ ...prev, total: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Payment Terms
                  </label>
                  <input
                    type="text"
                    value={editableData.paymentTerms}
                    onChange={(e) => setEditableData(prev => ({ ...prev, paymentTerms: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground"
                    placeholder="e.g., Net 30"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Delivery Terms
                  </label>
                  <input
                    type="text"
                    value={editableData.deliveryTerms}
                    onChange={(e) => setEditableData(prev => ({ ...prev, deliveryTerms: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground"
                    placeholder="e.g., 7-14 days"
                  />
                </div>
              </div>

              {/* Line Items Preview */}
              {result.extraction?.lineItems && result.extraction.lineItems.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">
                    Extracted Line Items ({result.extraction.lineItems.length})
                  </h4>
                  <div className="bg-secondary/50 rounded-lg p-3 max-h-40 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="pb-2">Description</th>
                          <th className="pb-2 text-right">Qty</th>
                          <th className="pb-2 text-right">Unit Price</th>
                          <th className="pb-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="text-foreground">
                        {result.extraction.lineItems.slice(0, 10).map((item: any, idx: number) => (
                          <tr key={idx} className="border-t border-gray-200 dark:border-gray-600">
                            <td className="py-1 truncate max-w-[200px]">{item.description}</td>
                            <td className="py-1 text-right">{item.quantity}</td>
                            <td className="py-1 text-right">{item.unitPrice?.toFixed(2)}</td>
                            <td className="py-1 text-right">{item.totalPrice?.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {result.extraction.lineItems.length > 10 && (
                      <p className="text-xs text-muted-foreground mt-2">
                        + {result.extraction.lineItems.length - 10} more items
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {result.warnings && result.warnings.length > 0 && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                  <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-1">
                    Warnings:
                  </p>
                  <ul className="text-xs text-yellow-700 dark:text-yellow-400 space-y-1">
                    {result.warnings.slice(0, 3).map((w, i) => (
                      <li key={i}>• {w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}
            </div>
          )}

          {step === 'complete' && result && (
            <div className="text-center py-8">
              <CheckCircle className="h-16 w-16 mx-auto text-green-500 mb-6" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                {quoteCreated ? 'Quote Created!' : 'Extraction Complete!'}
              </h3>
              <p className="text-muted-foreground mb-6">
                {quoteCreated
                  ? 'The quote has been added to this RFQ'
                  : `Successfully extracted ${result.extraction?.lineItems?.length || 0} line items${result.matching ? ` (${result.matching.totalMatched} matched to RFQ)` : ''}`
                }
              </p>

              {/* Summary */}
              <div className="bg-secondary/50 rounded-lg p-4 text-left mb-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Supplier:</span>
                    <p className="font-medium text-foreground">
                      {result.extraction?.supplier?.name || 'Unknown'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Quote #:</span>
                    <p className="font-medium text-foreground">
                      {result.extraction?.quoteInfo?.quoteNumber || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total:</span>
                    <p className="font-medium text-foreground">
                      {result.extraction?.totals?.currency || 'ZAR'}{' '}
                      {result.extraction?.totals?.total?.toLocaleString() || '0'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Processing:</span>
                    <p className="font-medium text-foreground">
                      {(result.processingTimeMs / 1000).toFixed(1)}s
                    </p>
                  </div>
                </div>
              </div>

              {/* Warnings */}
              {result.warnings && result.warnings.length > 0 && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-6 text-left">
                  <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-1">
                    Warnings:
                  </p>
                  <ul className="text-xs text-yellow-700 dark:text-yellow-400 space-y-1">
                    {result.warnings.slice(0, 3).map((w, i) => (
                      <li key={i}>• {w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {!quoteCreated && (
                <p className="text-sm text-muted-foreground">
                  Extraction complete. You can create the quote manually if needed.
                </p>
              )}
            </div>
          )}

          {step === 'error' && (
            <div className="text-center py-12">
              <AlertTriangle className="h-16 w-16 mx-auto text-red-500 mb-6" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                Extraction Failed
              </h3>
              <p className="text-muted-foreground mb-6">
                {error || 'An error occurred while processing the document'}
              </p>
              <Button variant="outline" onClick={handleReset}>
                Try Again
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-border">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>

          {step === 'upload' && (
            <Button
              onClick={handleExtract}
              disabled={!file || isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                'Extract Quote'
              )}
            </Button>
          )}

          {step === 'review' && (
            <>
              <Button variant="outline" onClick={handleReset}>
                Start Over
              </Button>
              <Button
                onClick={handleCreateQuote}
                disabled={isCreatingQuote || (selectedSupplierId === 'new' && !editableData.supplierName?.trim()) || !editableData.total}
              >
                {isCreatingQuote ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Quote'
                )}
              </Button>
            </>
          )}

          {step === 'complete' && !quoteCreated && (
            <Button onClick={handleCreateQuote} disabled={isCreatingQuote}>
              {isCreatingQuote ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Quote'
              )}
            </Button>
          )}

          {step === 'complete' && quoteCreated && (
            <Button onClick={handleClose}>
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default QuoteScannerModal;
