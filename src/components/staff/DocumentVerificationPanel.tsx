'use client';

/**
 * Document Verification Panel Component
 * Admin-only component for document verification workflow
 * Shows OCR-extracted data and allows editing before approval
 */

import { useState, useEffect, useCallback } from 'react';
import {
  X,
  CheckCircle,
  XCircle,
  FileText,
  Calendar,
  User,
  Building2,
  Hash,
  Download,
  AlertCircle,
  AlertTriangle,
  Clock,
  Image as ImageIcon,
  Edit3,
  Database,
  CreditCard,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { formatDisplayDate } from '@/utils/dateFormat';
import type { StaffDocument, DocumentVerification, OcrMetadata, DocumentType } from '@/types/staff-document.types';
import {
  DOCUMENT_TYPE_LABELS,
  VERIFICATION_STATUS_LABELS,
  OCR_ENABLED_DOCUMENTS,
} from '@/types/staff-document.types';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DocumentVerificationPanel');

// Validation result interface
interface ValidationMismatch {
  field: string;
  label: string;
  documentValue: string | null;
  recordValue: string | null;
  severity: 'critical' | 'warning' | 'info';
  message: string;
}

interface ValidationResult {
  isValid: boolean;
  matchScore: number;
  mismatches: ValidationMismatch[];
  matches: string[];
  staffRecord: {
    name: string;
    saIdNumber: string | null;
    position: string | null;
    department: string | null;
    startDate: string | null;
  } | null;
}

// OCR field configurations by document type
const OCR_FIELD_CONFIG: Record<string, { key: keyof OcrMetadata; label: string; placeholder: string }[]> = {
  sa_id: [
    { key: 'saIdNumber', label: 'SA ID Number', placeholder: '13 digit ID number' },
    { key: 'fullName', label: 'Full Name', placeholder: 'As on ID document' },
    { key: 'dateOfBirth', label: 'Date of Birth', placeholder: 'YYYY-MM-DD' },
  ],
  passport: [
    { key: 'passportNumber', label: 'Passport Number', placeholder: 'Passport number' },
    { key: 'passportCountry', label: 'Country', placeholder: 'Issuing country' },
    { key: 'passportExpiry', label: 'Expiry Date', placeholder: 'YYYY-MM-DD' },
    { key: 'fullName', label: 'Full Name', placeholder: 'As on passport' },
  ],
  drivers_license: [
    { key: 'driversLicenseNumber', label: 'License Number', placeholder: 'License number' },
    { key: 'driversLicenseCodes', label: 'License Codes', placeholder: 'e.g., B, C1, EB' },
    { key: 'driversLicenseExpiry', label: 'Expiry Date', placeholder: 'YYYY-MM-DD' },
    { key: 'fullName', label: 'Full Name', placeholder: 'As on license' },
  ],
  bank_details: [
    { key: 'bankName', label: 'Bank Name', placeholder: 'e.g., FNB, Standard Bank' },
    { key: 'bankAccountNumber', label: 'Account Number', placeholder: 'Bank account number' },
    { key: 'bankBranchCode', label: 'Branch Code', placeholder: '6 digit branch code' },
    { key: 'bankAccountType', label: 'Account Type', placeholder: 'Savings/Cheque' },
    { key: 'bankAccountHolder', label: 'Account Holder', placeholder: 'Name on account' },
  ],
  employment_contract: [
    { key: 'employeeName', label: 'Employee Name', placeholder: 'Full name of employee' },
    { key: 'employeeIdNumber', label: 'Employee ID Number', placeholder: '13 digit SA ID' },
    { key: 'companyName', label: 'Company Name', placeholder: 'Employer name' },
    { key: 'jobTitle', label: 'Job Title', placeholder: 'Position/role' },
    { key: 'startDate', label: 'Start Date', placeholder: 'YYYY-MM-DD' },
    { key: 'employmentType', label: 'Employment Type', placeholder: 'Permanent/Fixed-term' },
    { key: 'salary', label: 'Salary', placeholder: 'Amount' },
    { key: 'employeeSigned', label: '✍️ Employee Signed', placeholder: 'Yes/No' },
    { key: 'employerSigned', label: '✍️ Employer Signed', placeholder: 'Yes/No' },
    { key: 'witnessesSigned', label: '✍️ Witnesses Signed', placeholder: 'Yes/No' },
    { key: 'signatureNotes', label: 'Signature Notes', placeholder: 'e.g., Witnesses not signed' },
  ],
};

interface DocumentVerificationPanelProps {
  document: StaffDocument;
  onVerify: (documentId: string, verification: DocumentVerification) => Promise<{ success: boolean }>;
  onClose: () => void;
  isAdmin: boolean;
}

// Format file size to human-readable
const formatFileSize = (bytes?: number): string => {
  if (!bytes) return 'Unknown size';
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} bytes`;
};

// Format date for display
const formatDate = (dateString?: string): string => {
  return formatDisplayDate(dateString, '');
};

// Check if file is an image
const isImageFile = (mimeType?: string): boolean => {
  return mimeType?.startsWith('image/') || false;
};

export function DocumentVerificationPanel({
  document,
  onVerify,
  onClose,
  isAdmin,
}: DocumentVerificationPanelProps) {
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [notesRequired, setNotesRequired] = useState(false);
  const [editableOcr, setEditableOcr] = useState<OcrMetadata>({});
  const [isEditingOcr, setIsEditingOcr] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [showOverrideConfirm, setShowOverrideConfirm] = useState(false);

  // Document types that sync OCR data to staff table on verification
  const SYNC_TO_STAFF_TYPES: DocumentType[] = ['sa_id', 'passport', 'drivers_license', 'bank_details'];

  // Computed values - must be before useCallback/useEffect that use them
  const isPending = document.verificationStatus === 'pending';
  const isVerified = document.verificationStatus === 'verified';
  const isRejected = document.verificationStatus === 'rejected';
  const canTakeAction = isAdmin && isPending && !isSubmitting;
  const hasOcrSupport = OCR_ENABLED_DOCUMENTS.includes(document.documentType);
  const ocrFields = OCR_FIELD_CONFIG[document.documentType] || [];
  const hasOcrData = document.ocrMetadata && Object.keys(document.ocrMetadata).length > 0;

  // Initialize editable OCR from document on mount/change
  useEffect(() => {
    if (document.ocrMetadata) {
      setEditableOcr(document.ocrMetadata);
    }
  }, [document.ocrMetadata]);

  // Fetch validation results for pending documents with OCR data
  const fetchValidation = useCallback(async () => {
    if (!document.staffId || !document.ocrMetadata) return;

    setIsValidating(true);
    try {
      const response = await fetch(`/api/staff/${document.staffId}/validate-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentType: document.documentType,
          ocrData: document.ocrMetadata,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setValidation(data.validation);
      }
    } catch (err) {
      logger.warn('Failed to fetch document validation', { documentId: document.id, error: err });
    } finally {
      setIsValidating(false);
    }
  }, [document.staffId, document.ocrMetadata, document.documentType, document.id]);

  useEffect(() => {
    if (hasOcrSupport && isPending && document.ocrMetadata) {
      fetchValidation();
    }
  }, [hasOcrSupport, isPending, document.ocrMetadata, fetchValidation]);

  // Handle OCR field change
  const handleOcrFieldChange = (key: keyof OcrMetadata, value: string) => {
    setEditableOcr(prev => ({ ...prev, [key]: value }));
  };

  // Check if this document type will sync data to staff table
  const willSyncToStaff = SYNC_TO_STAFF_TYPES.includes(document.documentType);

  // Check if there are critical or warning mismatches that would override existing data
  const hasCriticalMismatches = validation?.mismatches.filter(m => m.severity === 'critical').length ?? 0;
  const hasWarningMismatches = validation?.mismatches.filter(m => m.severity === 'warning').length ?? 0;
  const needsOverrideConfirmation = willSyncToStaff && (hasCriticalMismatches > 0 || hasWarningMismatches > 0);

  const handleVerify = async (status: 'verified' | 'rejected') => {
    // Require notes for rejection
    if (status === 'rejected' && !notes.trim()) {
      setNotesRequired(true);
      return;
    }

    // Show confirmation dialog if approving with mismatches that will override staff data
    if (status === 'verified' && needsOverrideConfirmation && !showOverrideConfirm) {
      setShowOverrideConfirm(true);
      return;
    }

    setShowOverrideConfirm(false);
    setIsSubmitting(true);
    setError(null);
    setNotesRequired(false);

    try {
      const verification: DocumentVerification = {
        status,
        notes: notes.trim() || undefined,
        // Include edited OCR metadata for verified documents
        ocrMetadata: status === 'verified' && hasOcrSupport ? editableOcr : undefined,
      };

      await onVerify(document.id, verification);
      logger.info('Document verification submitted', { documentId: document.id, status });
      setSuccess(true);

      // Close panel after short delay
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Verification failed';
      setError(errMsg);
      logger.error('Document verification failed', { documentId: document.id, error: errMsg });
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelOverrideConfirm = () => {
    setShowOverrideConfirm(false);
  };

  const getStatusBadgeClasses = () => {
    switch (document.verificationStatus) {
      case 'verified':
        return 'bg-green-500/20 text-green-400';
      case 'rejected':
        return 'bg-red-500/20 text-red-400';
      case 'expired':
        return 'bg-gray-500/20 text-gray-400';
      default:
        return 'bg-yellow-500/20 text-yellow-400';
    }
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Document Verification</h2>
        <button
          onClick={onClose}
          className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] rounded-lg"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-6">
        {/* Status Badge */}
        <div className="flex items-center justify-between">
          <span className={`px-3 py-1 text-sm font-medium rounded-full ${getStatusBadgeClasses()}`}>
            {VERIFICATION_STATUS_LABELS[document.verificationStatus]}
          </span>
          {document.staff?.name && (
            <span className="text-sm text-[var(--ff-text-secondary)] flex items-center gap-1">
              <User className="h-4 w-4" />
              {document.staff.name}
            </span>
          )}
        </div>

        {/* Document Details */}
        <div className="space-y-4">
          <div>
            <h3 className="text-xl font-medium text-[var(--ff-text-primary)]">{document.documentName}</h3>
            <p className="text-sm text-[var(--ff-text-secondary)]">{DOCUMENT_TYPE_LABELS[document.documentType]}</p>
          </div>

          {/* Document Preview */}
          <div className="border border-[var(--ff-border-light)] rounded-lg p-4 bg-[var(--ff-bg-tertiary)]">
            {isImageFile(document.mimeType) ? (
              <img
                src={document.fileUrl}
                alt={document.documentName}
                className="max-w-full max-h-64 mx-auto rounded"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 py-4">
                <FileText className="h-12 w-12 text-[var(--ff-text-secondary)]" />
                <p className="text-sm text-[var(--ff-text-secondary)]">PDF Document Preview</p>
              </div>
            )}
            <div className="mt-3 text-center">
              <a
                href={document.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium"
              >
                <Download className="h-4 w-4" />
                View Document
              </a>
            </div>
          </div>

          {/* Document Metadata */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            {document.documentNumber && (
              <div className="flex items-start gap-2">
                <Hash className="h-4 w-4 text-[var(--ff-text-secondary)] mt-0.5" />
                <div>
                  <p className="text-[var(--ff-text-secondary)]">Document Number</p>
                  <p className="text-[var(--ff-text-primary)] font-medium">{document.documentNumber}</p>
                </div>
              </div>
            )}

            {document.issuingAuthority && (
              <div className="flex items-start gap-2">
                <Building2 className="h-4 w-4 text-[var(--ff-text-secondary)] mt-0.5" />
                <div>
                  <p className="text-[var(--ff-text-secondary)]">Issuing Authority</p>
                  <p className="text-[var(--ff-text-primary)] font-medium">{document.issuingAuthority}</p>
                </div>
              </div>
            )}

            {document.issuedDate && (
              <div className="flex items-start gap-2">
                <Calendar className="h-4 w-4 text-[var(--ff-text-secondary)] mt-0.5" />
                <div>
                  <p className="text-[var(--ff-text-secondary)]">Issue Date</p>
                  <p className="text-[var(--ff-text-primary)] font-medium">{formatDate(document.issuedDate)}</p>
                </div>
              </div>
            )}

            {document.expiryDate && (
              <div className="flex items-start gap-2">
                <Calendar className="h-4 w-4 text-[var(--ff-text-secondary)] mt-0.5" />
                <div>
                  <p className="text-[var(--ff-text-secondary)]">Expiry Date</p>
                  <p className="text-[var(--ff-text-primary)] font-medium">{formatDate(document.expiryDate)}</p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2">
              <FileText className="h-4 w-4 text-[var(--ff-text-secondary)] mt-0.5" />
              <div>
                <p className="text-[var(--ff-text-secondary)]">File Size</p>
                <p className="text-[var(--ff-text-primary)] font-medium">{formatFileSize(document.fileSize)}</p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Clock className="h-4 w-4 text-[var(--ff-text-secondary)] mt-0.5" />
              <div>
                <p className="text-[var(--ff-text-secondary)]">Uploaded</p>
                <p className="text-[var(--ff-text-primary)] font-medium">{formatDate(document.createdAt)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Validation Results - Show before OCR data */}
        {hasOcrSupport && isPending && validation && (
          <div className="space-y-3">
            {/* Critical Mismatches - Red Alert */}
            {validation.mismatches.filter(m => m.severity === 'critical').length > 0 && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldAlert className="h-5 w-5 text-red-400" />
                  <span className="text-sm font-semibold text-red-400">
                    ❌ Critical Mismatch - Verify Identity
                  </span>
                </div>
                {validation.mismatches.filter(m => m.severity === 'critical').map((m, i) => (
                  <div key={i} className="ml-7 text-sm text-red-300 mb-1">
                    <strong>{m.label}:</strong> Document shows "{m.documentValue || 'N/A'}" but staff record has "{m.recordValue || 'N/A'}"
                  </div>
                ))}
                <p className="ml-7 text-xs text-red-400/80 mt-2">
                  ⚠️ This document may belong to a different person. Reject if identity cannot be verified.
                </p>
              </div>
            )}

            {/* Warning Mismatches - Yellow Alert */}
            {validation.mismatches.filter(m => m.severity === 'warning').length > 0 && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="h-5 w-5 text-amber-400" />
                  <span className="text-sm font-semibold text-amber-400">
                    ⚠️ Data Differences Found
                  </span>
                </div>
                {validation.mismatches.filter(m => m.severity === 'warning').map((m, i) => (
                  <div key={i} className="ml-7 text-sm text-amber-300 mb-1">
                    <strong>{m.label}:</strong> Document shows "{m.documentValue || 'N/A'}", record has "{m.recordValue || 'N/A'}"
                  </div>
                ))}
              </div>
            )}

            {/* Info Notes */}
            {validation.mismatches.filter(m => m.severity === 'info').length > 0 && (
              <div className="p-3 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg">
                <p className="text-xs font-medium text-[var(--ff-text-secondary)] mb-2">ℹ️ Notes</p>
                {validation.mismatches.filter(m => m.severity === 'info').map((m, i) => (
                  <p key={i} className="text-xs text-[var(--ff-text-secondary)] mb-1">
                    {m.message}
                  </p>
                ))}
              </div>
            )}

            {/* All Matched - Green Success */}
            {validation.matches.length > 0 &&
             validation.mismatches.filter(m => m.severity === 'critical' || m.severity === 'warning').length === 0 && (
              <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-green-400" />
                  <span className="text-sm font-medium text-green-400">
                    ✅ Validated - Document matches staff record
                  </span>
                </div>
                <p className="ml-7 text-xs text-green-400/80">
                  Matched: {validation.matches.join(', ')}
                </p>
              </div>
            )}

            {/* Staff Record Reference */}
            {validation.staffRecord && (
              <div className="p-3 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg">
                <p className="text-xs font-medium text-[var(--ff-text-secondary)] mb-2">📋 Staff Record Reference</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[var(--ff-text-secondary)]">Name:</span>{' '}
                    <span className="text-[var(--ff-text-primary)]">{validation.staffRecord.name}</span>
                  </div>
                  {validation.staffRecord.saIdNumber && (
                    <div>
                      <span className="text-[var(--ff-text-secondary)]">ID:</span>{' '}
                      <span className="text-[var(--ff-text-primary)] font-mono">{validation.staffRecord.saIdNumber}</span>
                    </div>
                  )}
                  {validation.staffRecord.position && (
                    <div>
                      <span className="text-[var(--ff-text-secondary)]">Position:</span>{' '}
                      <span className="text-[var(--ff-text-primary)]">{validation.staffRecord.position}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Validation Loading State */}
        {hasOcrSupport && isPending && isValidating && (
          <div className="p-3 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg flex items-center gap-2">
            <div className="animate-spin h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full" />
            <span className="text-sm text-[var(--ff-text-secondary)]">Validating against staff record...</span>
          </div>
        )}

        {/* OCR Data Section - Only for OCR-enabled documents with pending status */}
        {hasOcrSupport && isPending && (
          <div className="border border-blue-500/30 rounded-lg bg-blue-500/5 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-blue-400" />
                <h4 className="text-sm font-semibold text-blue-400">
                  Data to be Saved on Approval
                </h4>
              </div>
              <button
                onClick={() => setIsEditingOcr(!isEditingOcr)}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
              >
                <Edit3 className="h-3 w-3" />
                {isEditingOcr ? 'Done Editing' : 'Edit Values'}
              </button>
            </div>

            <p className="text-xs text-[var(--ff-text-secondary)]">
              These values were extracted from the document via OCR and will be saved to the employee record when approved.
            </p>

            {hasOcrData || isEditingOcr ? (
              <div className="grid grid-cols-1 gap-3">
                {/* Primary fields from config */}
                {ocrFields.map(({ key, label, placeholder }) => (
                  <div key={key} className="space-y-1">
                    <label className="text-xs font-medium text-[var(--ff-text-secondary)]">
                      {label}
                    </label>
                    {isEditingOcr ? (
                      <input
                        type="text"
                        value={editableOcr[key] || ''}
                        onChange={(e) => handleOcrFieldChange(key, e.target.value)}
                        placeholder={placeholder}
                        className="w-full px-3 py-1.5 text-sm border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <div className="px-3 py-1.5 text-sm bg-[var(--ff-bg-tertiary)] rounded text-[var(--ff-text-primary)]">
                        {editableOcr[key] || document.ocrMetadata?.[key] || (
                          <span className="text-[var(--ff-text-secondary)] italic">Not detected</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Additional OCR fields not in config (e.g., surname, firstName, gender, etc.) */}
                {Object.entries(editableOcr || {})
                  .filter(([key]) => !ocrFields.some(f => f.key === key))
                  .map(([key, value]) => {
                    // Format camelCase to Title Case label
                    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
                    return (
                      <div key={key} className="space-y-1">
                        <label className="text-xs font-medium text-[var(--ff-text-secondary)]">
                          {label}
                        </label>
                        {isEditingOcr ? (
                          <input
                            type="text"
                            value={value || ''}
                            onChange={(e) => handleOcrFieldChange(key as keyof OcrMetadata, e.target.value)}
                            className="w-full px-3 py-1.5 text-sm border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          <div className="px-3 py-1.5 text-sm bg-[var(--ff-bg-tertiary)] rounded text-[var(--ff-text-primary)]">
                            {value || (
                              <span className="text-[var(--ff-text-secondary)] italic">Not detected</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className="text-sm text-[var(--ff-text-secondary)] italic">
                No OCR data extracted. You can manually enter values using the Edit button.
              </div>
            )}

            {/* Target database fields info */}
            <div className="text-xs text-[var(--ff-text-secondary)] border-t border-[var(--ff-border-light)] pt-3 mt-3">
              <strong>Target Fields:</strong>{' '}
              {document.documentType === 'sa_id' && 'staff.sa_id_number'}
              {document.documentType === 'passport' && 'staff.passport_number, passport_expiry, passport_country'}
              {document.documentType === 'drivers_license' && 'staff.drivers_license_number, expiry, codes'}
              {document.documentType === 'bank_details' && 'staff.bank_name, account_number, branch_code, account_type, account_holder'}
            </div>
          </div>
        )}

        {/* Verification History (for verified/rejected) */}
        {(isVerified || isRejected) && (
          <div className="border-t border-[var(--ff-border-light)] pt-4">
            <h4 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-3">Verification Details</h4>
            <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-3 space-y-2">
              {document.verifier?.name && (
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  <span className="font-medium">Verified by:</span> {document.verifier.name}
                </p>
              )}
              {document.verifiedAt && (
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  <span className="font-medium">Date:</span> {formatDate(document.verifiedAt)}
                </p>
              )}
              {document.verificationNotes && (
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  <span className="font-medium">Notes:</span> {document.verificationNotes}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Admin Verification Actions */}
        {isAdmin && isPending && (
          <div className="border-t border-[var(--ff-border-light)] pt-4 space-y-4">
            <div>
              <label htmlFor="verification-notes" className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Verification Notes
              </label>
              <textarea
                id="verification-notes"
                aria-label="Verification Notes"
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setNotesRequired(false);
                }}
                placeholder="Add notes about your verification decision..."
                className={`w-full px-3 py-2 border rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${
                  notesRequired ? 'border-red-500' : 'border-[var(--ff-border-light)]'
                }`}
                rows={3}
                disabled={isSubmitting}
              />
              {notesRequired && (
                <p className="text-sm text-red-400 mt-1">Notes are required when rejecting a document</p>
              )}
            </div>

            {/* Success Message */}
            {success && (
              <div className="p-3 bg-green-500/20 border border-green-500/30 rounded-lg flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-400" />
                <p className="text-sm text-green-400">Document verified successfully</p>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-red-400" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {/* Override Confirmation Dialog */}
            {showOverrideConfirm && (
              <div className="p-4 bg-amber-500/10 border-2 border-amber-500/50 rounded-lg space-y-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-6 w-6 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-amber-400">Confirm Data Override</h4>
                    <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                      Approving this document will <strong>override existing staff data</strong>:
                    </p>
                    <ul className="text-sm text-[var(--ff-text-secondary)] mt-2 space-y-1 list-disc list-inside">
                      {validation?.mismatches.filter(m => m.severity === 'critical' || m.severity === 'warning').map((m, i) => (
                        <li key={i} className={m.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}>
                          <strong>{m.label}:</strong> &quot;{m.recordValue || 'empty'}&quot; → &quot;{m.documentValue}&quot;
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={() => handleVerify('verified')}
                    disabled={isSubmitting}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 text-white font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50"
                  >
                    <CheckCircle className="h-4 w-4" />
                    Yes, Override Data
                  </button>
                  <button
                    onClick={cancelOverrideConfirm}
                    disabled={isSubmitting}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] font-medium rounded-lg border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            {!success && !showOverrideConfirm && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleVerify('verified')}
                  disabled={isSubmitting}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Verify document"
                >
                  {isSubmitting ? (
                    <>
                      <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4" />
                      Verify
                    </>
                  )}
                </button>
                <button
                  onClick={() => handleVerify('rejected')}
                  disabled={isSubmitting}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Reject document"
                >
                  <XCircle className="h-4 w-4" />
                  Reject
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
        <button
          onClick={onClose}
          className="w-full px-4 py-2 text-[var(--ff-text-secondary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] font-medium"
        >
          Close
        </button>
      </div>
    </div>
  );
}
