'use client';

/**
 * Document Verification Panel Component
 * Admin-only component for document verification workflow
 */

import { useState } from 'react';
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
  Clock,
  Image as ImageIcon,
} from 'lucide-react';
import type { StaffDocument, DocumentVerification } from '@/types/staff-document.types';
import {
  DOCUMENT_TYPE_LABELS,
  VERIFICATION_STATUS_LABELS,
} from '@/types/staff-document.types';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DocumentVerificationPanel');

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
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
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

  const isPending = document.verificationStatus === 'pending';
  const isVerified = document.verificationStatus === 'verified';
  const isRejected = document.verificationStatus === 'rejected';
  const canTakeAction = isAdmin && isPending && !isSubmitting;

  const handleVerify = async (status: 'verified' | 'rejected') => {
    // Require notes for rejection
    if (status === 'rejected' && !notes.trim()) {
      setNotesRequired(true);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setNotesRequired(false);

    try {
      const verification: DocumentVerification = {
        status,
        notes: notes.trim() || undefined,
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

            {/* Action Buttons */}
            {!success && (
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
