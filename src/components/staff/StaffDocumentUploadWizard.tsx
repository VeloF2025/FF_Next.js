'use client';

/**
 * Staff Document Upload Wizard - Type-First Upload Flow
 * PRD Reference: PRD-033 OCR-First Document Upload Flow (Updated)
 *
 * NEW 8-Step State Machine:
 * 1. select_type - User selects document type FIRST
 * 2. file_upload - User selects file(s) based on type
 * 3. ocr_processing - Uploading and processing OCR (if OCR-enabled type)
 * 4. ocr_preview - Show OCR results for confirmation (if confidence ≥50%)
 * 5. manual_entry - Manual field entry (if confidence <50% or upload-only type)
 * 6. confirmation - Final review before saving
 * 7. saving - Submitting to server
 * 8. complete - Success state
 */

import { useState, useCallback, useRef, useEffect, type ChangeEvent } from 'react';
import {
  X,
  Upload,
  FileText,
  AlertCircle,
  Loader2,
  CheckCircle,
  Edit3,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  ChevronRight,
} from 'lucide-react';
import {
  DocumentType,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENTS_WITH_EXPIRY,
  isOcrEnabled,
} from '@/types/staff-document.types';
import { createLogger } from '@/lib/logger';
import { DocumentTypeSelector } from './DocumentTypeSelector';

const logger = createLogger('StaffDocumentUploadWizard');

// Minimum confidence threshold for auto-preview (50%)
const OCR_PREVIEW_THRESHOLD = 0.50;

// Step type definition
type WizardStep =
  | 'select_type'
  | 'file_upload'
  | 'ocr_processing'
  | 'ocr_preview'
  | 'manual_entry'
  | 'confirmation'
  | 'saving'
  | 'complete';

// Wizard state interface
interface WizardState {
  currentStep: WizardStep;
  file: File | null;
  ocrResult: OcrPreviewResult | null;
  selectedDocumentType: DocumentType | null;
  documentName: string;
  extractedFields: Record<string, unknown>;
  fieldOverrides: Record<string, unknown>;
}

// OCR Preview API response interface
interface OcrPreviewResult {
  success: boolean;
  classification: {
    documentType: string;
    confidence: number;
    displayName: string;
    topGuesses: Array<{
      documentType: string;
      confidence: number;
      displayName: string;
    }>;
  };
  extractedFields: Record<string, {
    value: unknown;
    confidence: number;
    validated: boolean;
  }>;
  rawText: string;
  tierUsed: string;
  processingTimeMs: number;
}

interface StaffDocumentUploadWizardProps {
  staffId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function StaffDocumentUploadWizard({
  staffId,
  onSuccess,
  onCancel,
}: StaffDocumentUploadWizardProps) {
  // Wizard state
  const [state, setState] = useState<WizardState>({
    currentStep: 'select_type',
    file: null,
    ocrResult: null,
    selectedDocumentType: null,
    documentName: '',
    extractedFields: {},
    fieldOverrides: {},
  });

  const [error, setError] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Check if selected document type requires expiry date
  const requiresExpiry = state.selectedDocumentType
    ? DOCUMENTS_WITH_EXPIRY.includes(state.selectedDocumentType)
    : false;

  // =========================================================================
  // Step 1: Document Type Selection Handlers
  // =========================================================================

  const handleDocumentTypeSelect = useCallback((type: DocumentType) => {
    setState((prev) => ({
      ...prev,
      selectedDocumentType: type,
    }));
  }, []);

  const handleProceedToUpload = useCallback(() => {
    if (!state.selectedDocumentType) {
      setError('Please select a document type');
      return;
    }
    setError(null);
    setState((prev) => ({ ...prev, currentStep: 'file_upload' }));
  }, [state.selectedDocumentType]);

  // =========================================================================
  // Step 2: File Upload Handlers
  // =========================================================================

  const handleFileSelected = useCallback(async (file: File) => {
    setError(null);

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    if (!allowedTypes.includes(file.type)) {
      setError('Invalid file type. Please upload PDF, JPG, PNG, or Word files.');
      return;
    }

    // Validate file size (10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      setError('File too large. Maximum size is 10MB.');
      return;
    }

    // Update state with file
    setState((prev) => ({
      ...prev,
      file,
      documentName: prev.documentName || file.name.replace(/\.[^/.]+$/, ''),
    }));

    // Generate preview for images
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        setFilePreview(evt.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setFilePreview(null);
    }

    // Route based on document type
    if (state.selectedDocumentType && isOcrEnabled(state.selectedDocumentType)) {
      // OCR-enabled document - process OCR
      await processOcr(file);
    } else {
      // Upload-only document - skip OCR, go to manual entry
      setState((prev) => ({ ...prev, currentStep: 'manual_entry' }));
    }
  }, [state.selectedDocumentType]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelected(selectedFile);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      handleFileSelected(droppedFile);
    }
  };

  const handleLabelClick = () => {
    const fileInput = document.getElementById('wizard-file-upload') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  };

  // =========================================================================
  // Step 2: OCR Processing
  // =========================================================================

  const processOcr = async (file: File) => {
    setState((prev) => ({ ...prev, currentStep: 'ocr_processing' }));
    setError(null);

    // Create abort controller with 30s timeout
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      // Prepare form data
      const formData = new FormData();
      formData.append('file', file);
      formData.append('staffId', staffId);
      formData.append('entityType', 'staff');

      // Include document type hint for OCR (type-first flow)
      if (state.selectedDocumentType) {
        formData.append('documentType', state.selectedDocumentType);
      }

      // Call OCR preview API
      const response = await fetch('/api/documents-ocr-preview', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'OCR processing failed' }));
        throw new Error(errorData.error || `OCR failed with status ${response.status}`);
      }

      const result: OcrPreviewResult = await response.json();

      // Update state with OCR result (keep user-selected type in type-first flow)
      setState((prev) => ({
        ...prev,
        ocrResult: result,
        // Keep user-selected type instead of auto-detected
        extractedFields: result.extractedFields,
      }));

      // Route based on confidence
      const overallConfidence = result.classification.confidence;

      if (overallConfidence >= OCR_PREVIEW_THRESHOLD) {
        // High confidence - show preview for confirmation
        setState((prev) => ({ ...prev, currentStep: 'ocr_preview' }));
        logger.info('OCR completed with high confidence', {
          confidence: overallConfidence,
          documentType: state.selectedDocumentType,
        });
      } else {
        // Low confidence - go to manual entry
        setState((prev) => ({ ...prev, currentStep: 'manual_entry' }));
        logger.info('OCR completed with low confidence', {
          confidence: overallConfidence,
          documentType: state.selectedDocumentType,
        });
      }
    } catch (err) {
      clearTimeout(timeout);

      if (err instanceof Error && err.name === 'AbortError') {
        setError('OCR processing timed out after 30 seconds. Please try manual entry.');
        setState((prev) => ({ ...prev, currentStep: 'manual_entry' }));
      } else {
        const errorMessage = err instanceof Error ? err.message : 'OCR processing failed';
        setError(errorMessage);
        setState((prev) => ({ ...prev, currentStep: 'manual_entry' }));
        logger.error('OCR processing error', { error: errorMessage });
      }
    }
  };

  // =========================================================================
  // Step 3: OCR Preview Handlers
  // =========================================================================

  const handleAcceptOcrFields = () => {
    setState((prev) => ({ ...prev, currentStep: 'confirmation' }));
  };

  const handleEditOcrFields = () => {
    setState((prev) => ({ ...prev, currentStep: 'manual_entry' }));
  };

  const handleFieldOverride = (fieldName: string, value: unknown) => {
    setState((prev) => ({
      ...prev,
      fieldOverrides: {
        ...prev.fieldOverrides,
        [fieldName]: value,
      },
    }));
  };

  // =========================================================================
  // Step 4 & 5: Manual Entry & Confirmation
  // =========================================================================

  const handleManualFieldChange = (fieldName: string, value: unknown) => {
    setState((prev) => ({
      ...prev,
      fieldOverrides: {
        ...prev.fieldOverrides,
        [fieldName]: value,
      },
    }));
  };

  const handleProceedToConfirmation = () => {
    setState((prev) => ({ ...prev, currentStep: 'confirmation' }));
  };

  // =========================================================================
  // Step 6: Final Submit
  // =========================================================================

  const handleSubmit = async () => {
    const isDriversLicense = state.selectedDocumentType === 'drivers_license';

    // Validate file presence
    if (!state.file) {
      setError('No file selected');
      return;
    }

    if (!state.selectedDocumentType) {
      setError('No document type selected');
      return;
    }

    setState((prev) => ({ ...prev, currentStep: 'saving' }));
    setError(null);

    try {
      // Prepare form data
      const formData = new FormData();
      formData.append('staffId', staffId);
      formData.append('documentType', state.selectedDocumentType);
      formData.append('documentName', state.documentName);
      formData.append('file', state.file);

      // Add OCR confirmed flag if OCR was used
      if (state.ocrResult) {
        formData.append('ocrConfirmed', 'true');
      }

      // Add extracted fields + overrides
      const finalFields = {
        ...state.extractedFields,
        ...state.fieldOverrides,
      };

      // Helper to extract value from OCR field objects or raw values
      const extractValue = (field: unknown): string => {
        if (field === null || field === undefined) return '';
        if (typeof field === 'object' && 'value' in field) {
          return String((field as { value: unknown }).value ?? '');
        }
        return String(field);
      };

      // Extract common fields (handle both OCR field objects and raw values)
      const idNumber = extractValue(finalFields.idNumber) || extractValue(finalFields.documentNumber);
      const issuedDate = extractValue(finalFields.issuedDate) || extractValue(finalFields.issueDate);
      const expiryDate = extractValue(finalFields.expiryDate) || extractValue(finalFields.expirationDate);
      const issuingAuthority = extractValue(finalFields.issuingAuthority);

      if (idNumber) {
        formData.append('idNumber', idNumber);
      }
      if (issuedDate) {
        formData.append('issuedDate', issuedDate);
      }
      if (expiryDate) {
        formData.append('expiryDate', expiryDate);
      }
      if (issuingAuthority) {
        formData.append('issuingAuthority', issuingAuthority);
      }

      // Add driver's license specific fields
      if (isDriversLicense) {
        const licenseNumber = extractValue(finalFields.licenseNumber);
        const licenseCodes = extractValue(finalFields.licenseCodes);
        const validFrom = extractValue(finalFields.validFrom);
        const validTo = extractValue(finalFields.validTo);

        if (licenseNumber) formData.append('licenseNumber', licenseNumber);
        if (licenseCodes) formData.append('licenseCodes', licenseCodes);
        if (validFrom) formData.append('validFrom', validFrom);
        if (validTo) formData.append('validTo', validTo);
      }

      // Upload document
      const response = await fetch('/api/staff-documents-upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(errorData.error || 'Failed to upload document');
      }

      // Success
      setState((prev) => ({ ...prev, currentStep: 'complete' }));
      logger.info('Document uploaded successfully', {
        staffId,
        documentType: state.selectedDocumentType,
      });

      // Close wizard after 1.5 seconds
      setTimeout(() => {
        onSuccess();
      }, 1500);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Upload failed';
      setError(errorMessage);
      setState((prev) => ({ ...prev, currentStep: 'confirmation' }));
      logger.error('Document upload error', { error: errorMessage });
    }
  };

  // =========================================================================
  // Render Step Content
  // =========================================================================

  const renderStepContent = () => {
    switch (state.currentStep) {
      case 'select_type':
        return (
          <div className="space-y-6">
            <DocumentTypeSelector
              selectedType={state.selectedDocumentType}
              onSelect={handleDocumentTypeSelect}
              existingDocumentTypes={[]}
            />

            <div className="flex justify-end pt-4 border-t border-[var(--ff-border-light)]">
              <button
                onClick={handleProceedToUpload}
                disabled={!state.selectedDocumentType}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        );

      case 'file_upload':
        // All document types use single file upload (including driver's license - front only)
        const documentLabel = state.selectedDocumentType
          ? DOCUMENT_TYPE_LABELS[state.selectedDocumentType]
          : 'Document';

        // Standard single file upload for all document types
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => setState((prev) => ({ ...prev, currentStep: 'select_type' }))}
                className="p-1 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <h3 className="text-lg font-medium text-[var(--ff-text-primary)]">
                Upload {documentLabel}
              </h3>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                Select Document File
              </label>
              <label
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                className="relative flex items-center justify-center gap-3 px-4 py-8 border-2 border-dashed rounded-lg cursor-pointer transition-colors border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] hover:border-blue-400 hover:bg-blue-500/10"
              >
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  id="wizard-file-upload"
                  aria-label="Upload document file"
                />
                <Upload className="h-8 w-8 text-[var(--ff-text-secondary)]" />
                <div className="text-center">
                  <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
                    PDF, JPG, PNG, Word (Max 10MB)
                  </p>
                </div>
              </label>
            </div>

            {filePreview && (
              <div className="mt-4">
                <img
                  src={filePreview}
                  alt="Preview"
                  className="max-h-48 rounded-lg border border-[var(--ff-border-light)] mx-auto"
                />
              </div>
            )}
          </div>
        );

      case 'ocr_processing':
        return (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="h-12 w-12 text-blue-500 animate-spin" />
            <div className="text-center">
              <p className="text-lg font-medium text-[var(--ff-text-primary)]">
                Processing Document...
              </p>
              <p className="text-sm text-[var(--ff-text-secondary)] mt-2">
                Extracting information from your document
              </p>
              <p className="text-xs text-[var(--ff-text-secondary)] mt-1 opacity-70">
                This may take up to 30 seconds
              </p>
            </div>
          </div>
        );

      case 'ocr_preview':
        return renderOcrPreview();

      case 'manual_entry':
        return renderManualEntry();

      case 'confirmation':
        return renderConfirmation();

      case 'saving':
        return (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="h-12 w-12 text-blue-500 animate-spin" />
            <div className="text-center">
              <p className="text-lg font-medium text-[var(--ff-text-primary)]">
                Saving Document...
              </p>
              <p className="text-sm text-[var(--ff-text-secondary)] mt-2">
                Uploading to secure storage
              </p>
            </div>
          </div>
        );

      case 'complete':
        return (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <div className="h-16 w-16 rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle className="h-10 w-10 text-green-400" />
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-[var(--ff-text-primary)]">
                Document Uploaded Successfully!
              </p>
              <p className="text-sm text-[var(--ff-text-secondary)] mt-2">
                The document has been saved and is ready for verification
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const renderOcrPreview = () => {
    if (!state.ocrResult) return null;

    const { classification, extractedFields } = state.ocrResult;

    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <Sparkles className="h-5 w-5 text-blue-400 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-blue-400">
              OCR Extraction Complete
            </p>
            <p className="text-xs text-blue-400/80 mt-1">
              Detected: {classification.displayName} (
              {Math.round(classification.confidence * 100)}% confidence)
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium text-[var(--ff-text-primary)]">
            Extracted Fields
          </h3>
          {Object.entries(extractedFields as Record<string, { value: unknown; confidence: number; validated: boolean }>).map(([key, field]) => (
            <div
              key={key}
              className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg border border-[var(--ff-border-light)]"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </span>
                <span className="text-xs text-[var(--ff-text-secondary)]">
                  {Math.round(field.confidence * 100)}% confident
                </span>
              </div>
              <input
                type="text"
                value={String(state.fieldOverrides[key] ?? field.value ?? '')}
                onChange={(e) => handleFieldOverride(key, e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 pt-4">
          <button
            onClick={handleEditOcrFields}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]"
          >
            <Edit3 className="h-4 w-4" />
            Edit More Fields
          </button>
          <button
            onClick={handleAcceptOcrFields}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Accept & Continue
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  };

  const renderManualEntry = () => {
    const isDriversLicense = state.selectedDocumentType === 'drivers_license';

    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <AlertCircle className="h-5 w-5 text-amber-400 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-400">
              {isDriversLicense ? 'Enter Driver\'s License Details' : 'Manual Entry Required'}
            </p>
            <p className="text-xs text-amber-400/80 mt-1">
              {state.ocrResult
                ? 'Please verify the extracted text and enter details below.'
                : 'Please enter document details manually.'}
            </p>
          </div>
        </div>

        {/* Show raw OCR text if available */}
        {state.ocrResult?.rawText && (
          <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg border border-[var(--ff-border-light)]">
            <p className="text-xs font-medium text-[var(--ff-text-secondary)] mb-2">
              Extracted Text (for reference)
            </p>
            <div className="max-h-32 overflow-y-auto">
              <pre className="text-xs text-[var(--ff-text-primary)] whitespace-pre-wrap font-mono">
                {state.ocrResult.rawText}
              </pre>
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
            Document Type *
          </label>
          <select
            value={state.selectedDocumentType || ''}
            onChange={(e) =>
              setState((prev) => ({
                ...prev,
                selectedDocumentType: e.target.value as DocumentType,
              }))
            }
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="" disabled>Select a document type</option>
            {Object.entries(DOCUMENT_CATEGORIES).map(([category, types]) => (
              <optgroup key={category} label={DOCUMENT_CATEGORY_LABELS[category]}>
                {types.map((type) => (
                  <option key={type} value={type}>
                    {DOCUMENT_TYPE_LABELS[type]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
            Document Name *
          </label>
          <input
            type="text"
            value={state.documentName}
            onChange={(e) =>
              setState((prev) => ({ ...prev, documentName: e.target.value }))
            }
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., SA ID Card, Driving License"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
            ID Number *
          </label>
          <input
            type="text"
            value={String(state.fieldOverrides.idNumber ?? '')}
            onChange={(e) => handleManualFieldChange('idNumber', e.target.value)}
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., 7802030000000"
          />
        </div>

        {/* Driver's License specific fields */}
        {isDriversLicense && (
          <>
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                License Number *
              </label>
              <input
                type="text"
                value={String(state.fieldOverrides.licenseNumber ?? '')}
                onChange={(e) => handleManualFieldChange('licenseNumber', e.target.value)}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., 3JO004U08RD49"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                License Codes *
              </label>
              <input
                type="text"
                value={String(state.fieldOverrides.licenseCodes ?? '')}
                onChange={(e) => handleManualFieldChange('licenseCodes', e.target.value)}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., EB, C1, A"
              />
              <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
                Enter all license codes separated by comma
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                  Valid From *
                </label>
                <input
                  type="date"
                  value={String(state.fieldOverrides.validFrom ?? '')}
                  onChange={(e) => handleManualFieldChange('validFrom', e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                  Valid To *
                </label>
                <input
                  type="date"
                  value={String(state.fieldOverrides.validTo ?? '')}
                  onChange={(e) => handleManualFieldChange('validTo', e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </>
        )}

        {/* Standard date fields for non-license documents */}
        {!isDriversLicense && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                Issue Date
              </label>
              <input
                type="date"
                value={String(state.fieldOverrides.issuedDate ?? '')}
                onChange={(e) => handleManualFieldChange('issuedDate', e.target.value)}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                Expiry Date {requiresExpiry && '*'}
              </label>
              <input
                type="date"
                value={String(state.fieldOverrides.expiryDate ?? '')}
                onChange={(e) => handleManualFieldChange('expiryDate', e.target.value)}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        <div className="flex justify-end pt-4">
          <button
            onClick={handleProceedToConfirmation}
            disabled={!state.documentName}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  };

  const renderConfirmation = () => {
    const finalFields = {
      ...state.extractedFields,
      ...state.fieldOverrides,
    };

    const isDriversLicense = state.selectedDocumentType === 'drivers_license';

    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
          Review & Confirm
        </h3>

        <div className="space-y-3">
          <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
            <p className="text-xs text-[var(--ff-text-secondary)] mb-1">File</p>
            <p className="text-sm font-medium text-[var(--ff-text-primary)]">
              {state.file?.name}
            </p>
          </div>

          <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
            <p className="text-xs text-[var(--ff-text-secondary)] mb-1">Document Type</p>
            <p className="text-sm font-medium text-[var(--ff-text-primary)]">
              {state.selectedDocumentType ? DOCUMENT_TYPE_LABELS[state.selectedDocumentType] : 'Not selected'}
            </p>
          </div>

          <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
            <p className="text-xs text-[var(--ff-text-secondary)] mb-1">Document Name</p>
            <p className="text-sm font-medium text-[var(--ff-text-primary)]">
              {state.documentName}
            </p>
          </div>

          {Object.keys(finalFields).length > 0 && (
            <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
              <p className="text-xs text-[var(--ff-text-secondary)] mb-2">Extracted Data</p>
              <div className="space-y-1">
                {Object.entries(finalFields).map(([key, value]) => {
                  // Handle both raw values and OCR field objects {value, confidence, validated}
                  const displayValue = typeof value === 'object' && value !== null && 'value' in value
                    ? String((value as { value: unknown }).value ?? '')
                    : String(value ?? '');
                  return (
                    <div key={key} className="flex items-center justify-between text-sm">
                      <span className="text-[var(--ff-text-secondary)]">
                        {key.replace(/([A-Z])/g, ' $1').trim()}:
                      </span>
                      <span className="text-[var(--ff-text-primary)] font-medium">
                        {displayValue}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-4">
          <button
            onClick={() => setState((prev) => ({ ...prev, currentStep: 'manual_entry' }))}
            className="flex items-center gap-2 px-4 py-2 border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Upload Document
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  };

  // =========================================================================
  // Main Render
  // =========================================================================

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto m-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--ff-border-light)]">
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">
            Upload Document
          </h2>
          <button
            onClick={onCancel}
            className="p-1 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
            disabled={state.currentStep === 'ocr_processing' || state.currentStep === 'saving'}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Error Banner */}
          {error && (
            <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-400">Error</p>
                <p className="text-sm text-red-400/80 mt-1">{error}</p>
              </div>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Step Content */}
          {renderStepContent()}
        </div>
      </div>
    </div>
  );
}
