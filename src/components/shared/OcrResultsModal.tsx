'use client';

/**
 * OCR Results Modal
 * Displays OCR extraction results and allows user to confirm/apply extracted fields
 * PRD Reference: PRD-032 OCR Document Extraction System
 */

import { useState, useCallback, useMemo } from 'react';
import {
  X,
  Sparkles,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Clock,
} from 'lucide-react';
import {
  type OcrResult,
  type ExtractedField,
  type FieldsToApply,
  OcrStatus,
  OcrTier,
} from '@/types/ocr.types';

// ============================================================================
// Types
// ============================================================================

interface OcrResultsModalProps {
  /** OCR result to display */
  result: OcrResult;
  /** Current entity data for comparison */
  currentEntityData: Record<string, unknown>;
  /** Whether modal is open */
  isOpen: boolean;
  /** Close handler */
  onClose: () => void;
  /** Confirm handler - receives fields to apply */
  onConfirm: (fieldsToApply: FieldsToApply) => Promise<void>;
  /** Loading state during confirmation */
  isConfirming: boolean;
}

interface FieldSelection {
  fieldName: string;
  extractedValue: string | number | boolean | null;
  currentValue: string | number | boolean | null;
  useExtracted: boolean;
  confidence: number;
  validated: boolean;
  validationMessage?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format field name for display (camelCase to Title Case)
 */
function formatFieldName(fieldName: string): string {
  return fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

/**
 * Format value for display
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Get confidence color class
 */
function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.9) return 'text-green-400';
  if (confidence >= 0.7) return 'text-yellow-400';
  return 'text-red-400';
}

/**
 * Get confidence background color class
 */
function getConfidenceBgColor(confidence: number): string {
  if (confidence >= 0.9) return 'bg-green-500/20';
  if (confidence >= 0.7) return 'bg-yellow-500/20';
  return 'bg-red-500/20';
}

/**
 * Get OCR tier display name
 */
function getTierDisplayName(tier: OcrTier | null): string {
  switch (tier) {
    case OcrTier.TESSERACT:
      return 'Tesseract';
    case OcrTier.PADDLEOCR:
      return 'PaddleOCR';
    case OcrTier.OCRSPACE:
      return 'OCR.space';
    case OcrTier.GEMINI:
      return 'Gemini Vision';
    default:
      return 'Unknown';
  }
}

// ============================================================================
// Component
// ============================================================================

export function OcrResultsModal({
  result,
  currentEntityData,
  isOpen,
  onClose,
  onConfirm,
  isConfirming,
}: OcrResultsModalProps) {
  // Initialize field selections from extracted fields
  const initialSelections = useMemo(() => {
    const selections: FieldSelection[] = [];

    if (result.extractedFields) {
      Object.entries(result.extractedFields).forEach(([fieldName, field]) => {
        const extractedField = field as ExtractedField;
        const currentValue = currentEntityData[fieldName] as string | number | boolean | null;

        selections.push({
          fieldName,
          extractedValue: extractedField.value,
          currentValue,
          useExtracted: extractedField.confidence >= 0.7, // Default to extracted if high confidence
          confidence: extractedField.confidence,
          validated: extractedField.validated ?? false,
          validationMessage: extractedField.validationMessage,
        });
      });
    }

    return selections;
  }, [result.extractedFields, currentEntityData]);

  const [fieldSelections, setFieldSelections] = useState<FieldSelection[]>(initialSelections);
  const [showRawText, setShowRawText] = useState(false);

  // Toggle field selection
  const toggleFieldSelection = useCallback((fieldName: string) => {
    setFieldSelections((prev) =>
      prev.map((sel) =>
        sel.fieldName === fieldName ? { ...sel, useExtracted: !sel.useExtracted } : sel
      )
    );
  }, []);

  // Select all extracted values
  const selectAllExtracted = useCallback(() => {
    setFieldSelections((prev) => prev.map((sel) => ({ ...sel, useExtracted: true })));
  }, []);

  // Keep all current values
  const keepAllCurrent = useCallback(() => {
    setFieldSelections((prev) => prev.map((sel) => ({ ...sel, useExtracted: false })));
  }, []);

  // Handle confirm
  const handleConfirm = useCallback(async () => {
    const fieldsToApply: FieldsToApply = {};

    fieldSelections.forEach((sel) => {
      fieldsToApply[sel.fieldName] = {
        value: sel.useExtracted ? sel.extractedValue : sel.currentValue,
        useExtracted: sel.useExtracted,
      };
    });

    await onConfirm(fieldsToApply);
  }, [fieldSelections, onConfirm]);

  // Count selected fields
  const selectedCount = fieldSelections.filter((sel) => sel.useExtracted).length;
  const totalCount = fieldSelections.length;

  // Check if already confirmed
  const isAlreadyConfirmed = result.status === OcrStatus.CONFIRMED;

  if (!isOpen) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="OCR Results" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden mx-4 sm:mx-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--ff-border-light)] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <Sparkles className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                OCR Extraction Results
              </h2>
              <p className="text-xs text-[var(--ff-text-secondary)] mt-0.5">
                {result.detectedDocumentType
                  ? `Detected: ${formatFieldName(result.detectedDocumentType)}`
                  : 'Document analyzed'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
            disabled={isConfirming}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Status Banner */}
          {isAlreadyConfirmed ? (
            <div className="flex items-start gap-3 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
              <CheckCircle className="h-5 w-5 text-green-400 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-green-400">Already Applied</p>
                <p className="text-xs text-green-400/80 mt-1">
                  These OCR results have already been confirmed and applied.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <Sparkles className="h-5 w-5 text-blue-400 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-400">Review Extracted Data</p>
                <p className="text-xs text-blue-400/80 mt-1">
                  Select which fields to apply from the OCR extraction. Toggle each field to choose
                  between extracted and current values.
                </p>
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="flex items-center gap-4 text-xs text-[var(--ff-text-secondary)]">
            {result.overallConfidence !== null && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${getConfidenceBgColor(result.overallConfidence)}`}
              >
                <span className={getConfidenceColor(result.overallConfidence)}>
                  {Math.round(result.overallConfidence * 100)}% confidence
                </span>
              </span>
            )}
            {result.ocrTierUsed && (
              <span className="inline-flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {getTierDisplayName(result.ocrTierUsed)}
              </span>
            )}
            {result.processingTimeMs && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {(result.processingTimeMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>

          {/* Bulk Actions */}
          {!isAlreadyConfirmed && fieldSelections.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={selectAllExtracted}
                className="text-xs px-3 py-1.5 border border-[var(--ff-border-light)] rounded-md text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]"
              >
                Select All Extracted
              </button>
              <button
                onClick={keepAllCurrent}
                className="text-xs px-3 py-1.5 border border-[var(--ff-border-light)] rounded-md text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]"
              >
                Keep All Current
              </button>
              <span className="text-xs text-[var(--ff-text-secondary)] ml-auto">
                {selectedCount} of {totalCount} fields selected
              </span>
            </div>
          )}

          {/* Field List */}
          {fieldSelections.length > 0 ? (
            <div className="space-y-3">
              {fieldSelections.map((sel) => (
                <div
                  key={sel.fieldName}
                  className={`p-4 rounded-lg border transition-colors ${
                    sel.useExtracted
                      ? 'bg-purple-500/5 border-purple-500/30'
                      : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                        {formatFieldName(sel.fieldName)}
                      </span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${getConfidenceBgColor(sel.confidence)} ${getConfidenceColor(sel.confidence)}`}
                      >
                        {Math.round(sel.confidence * 100)}%
                      </span>
                      {sel.validated && (
                        <CheckCircle className="h-3.5 w-3.5 text-green-400" />
                      )}
                      {sel.validationMessage && !sel.validated && (
                        <span title={sel.validationMessage}>
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                        </span>
                      )}
                    </div>
                    {!isAlreadyConfirmed && (
                      <button
                        onClick={() => toggleFieldSelection(sel.fieldName)}
                        className={`p-1.5 rounded-md transition-colors ${
                          sel.useExtracted
                            ? 'bg-purple-500 text-white'
                            : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
                        }`}
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Current Value */}
                    <div
                      className={`p-3 rounded-md border ${
                        !sel.useExtracted
                          ? 'border-blue-500/50 bg-blue-500/5'
                          : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]'
                      }`}
                    >
                      <p className="text-xs text-[var(--ff-text-secondary)] mb-1">Current</p>
                      <p
                        className={`text-sm ${
                          !sel.useExtracted
                            ? 'text-blue-400 font-medium'
                            : 'text-[var(--ff-text-primary)]'
                        }`}
                      >
                        {formatValue(sel.currentValue)}
                      </p>
                    </div>

                    {/* Extracted Value */}
                    <div
                      className={`p-3 rounded-md border ${
                        sel.useExtracted
                          ? 'border-purple-500/50 bg-purple-500/5'
                          : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]'
                      }`}
                    >
                      <p className="text-xs text-[var(--ff-text-secondary)] mb-1 flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />
                        Extracted
                      </p>
                      <p
                        className={`text-sm ${
                          sel.useExtracted
                            ? 'text-purple-400 font-medium'
                            : 'text-[var(--ff-text-primary)]'
                        }`}
                      >
                        {formatValue(sel.extractedValue)}
                      </p>
                    </div>
                  </div>

                  {sel.validationMessage && (
                    <p className="text-xs text-amber-400 mt-2 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {sel.validationMessage}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-[var(--ff-text-secondary)] mx-auto mb-3 opacity-50" />
              <p className="text-[var(--ff-text-secondary)]">No fields extracted</p>
              <p className="text-sm text-[var(--ff-text-secondary)] opacity-70 mt-1">
                OCR could not extract any fields from this document
              </p>
            </div>
          )}

          {/* Raw Text Collapsible */}
          {result.rawText && (
            <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
              <button
                onClick={() => setShowRawText(!showRawText)}
                className="w-full flex items-center justify-between px-4 py-3 bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-hover)] transition-colors"
              >
                <span className="text-sm text-[var(--ff-text-secondary)]">Raw OCR Text</span>
                {showRawText ? (
                  <ChevronUp className="h-4 w-4 text-[var(--ff-text-secondary)]" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-[var(--ff-text-secondary)]" />
                )}
              </button>
              {showRawText && (
                <div className="p-4 bg-[var(--ff-bg-secondary)]">
                  <pre className="text-xs text-[var(--ff-text-secondary)] whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                    {result.rawText}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-[var(--ff-border-light)] flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]"
            disabled={isConfirming}
          >
            {isAlreadyConfirmed ? 'Close' : 'Cancel'}
          </button>

          {!isAlreadyConfirmed && fieldSelections.length > 0 && (
            <button
              onClick={handleConfirm}
              disabled={isConfirming || selectedCount === 0}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isConfirming ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  Apply {selectedCount} Field{selectedCount !== 1 ? 's' : ''}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default OcrResultsModal;
