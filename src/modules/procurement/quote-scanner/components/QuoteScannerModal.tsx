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

type ModalStep = 'upload' | 'processing' | 'complete' | 'error';

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

      setProgress(80);

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || data.error || 'Extraction failed');
      }

      setProgress(100);
      setResult(data);
      setStep('complete');

      // Notify parent
      onExtractionComplete(data.extraction, data.matching, data.extractionId);

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop - don't close during processing */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={step === 'processing' ? undefined : handleClose}
      />

      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Scan Quote Document
              </h2>
              {rfqNumber && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Matching to {rfqNumber}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
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
                    : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500'
                  }
                `}
              >
                {!file ? (
                  <>
                    <Upload className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <p className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Drop your quote document here
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                      or click to browse
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Select File
                    </Button>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">
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
                        <div className="w-20 h-20 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                          <FileImage className="h-10 w-10 text-gray-400" />
                        </div>
                      )}
                      <div className="text-left">
                        <p className="font-medium text-gray-900 dark:text-white">
                          {file.name}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
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
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Analyzing Document
              </h3>
              <p className="text-gray-500 dark:text-gray-400 mb-6">
                Extracting quote data using AI...
              </p>

              {/* Progress Bar */}
              <div className="w-full max-w-xs mx-auto bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-sm text-gray-400 mt-2">{progress}%</p>
            </div>
          )}

          {step === 'complete' && result && (
            <div className="text-center py-8">
              <CheckCircle className="h-16 w-16 mx-auto text-green-500 mb-6" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Extraction Complete!
              </h3>
              <p className="text-gray-500 dark:text-gray-400 mb-6">
                Successfully extracted {result.extraction.lineItems?.length || 0} line items
                {result.matching && ` (${result.matching.totalMatched} matched to RFQ)`}
              </p>

              {/* Summary */}
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 text-left mb-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Supplier:</span>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {result.extraction.supplier?.name || 'Unknown'}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Quote #:</span>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {result.extraction.quoteInfo?.quoteNumber || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Total:</span>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {result.extraction.totals?.currency || 'ZAR'}{' '}
                      {result.extraction.totals?.total?.toLocaleString() || '0'}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Processing:</span>
                    <p className="font-medium text-gray-900 dark:text-white">
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

              <p className="text-sm text-gray-500 dark:text-gray-400">
                Click "Done" to review and edit the extracted data
              </p>
            </div>
          )}

          {step === 'error' && (
            <div className="text-center py-12">
              <AlertTriangle className="h-16 w-16 mx-auto text-red-500 mb-6" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Extraction Failed
              </h3>
              <p className="text-gray-500 dark:text-gray-400 mb-6">
                {error || 'An error occurred while processing the document'}
              </p>
              <Button variant="outline" onClick={handleReset}>
                Try Again
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
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

          {step === 'complete' && (
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
