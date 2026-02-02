'use client';

/**
 * Document Verification Modal
 *
 * Shows OCR-extracted data for verification.
 * Allows verify/reject actions on pending documents.
 * Used by Fleet for driver's license verification.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  X,
  Loader2,
  Shield,
  CheckCircle,
  XCircle,
  FileText,
  AlertCircle,
  User,
  Calendar,
  Hash,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';

interface OcrMetadata {
  fullName?: string;
  idNumber?: string;
  documentNumber?: string;
  dateOfBirth?: string;
  expiryDate?: string;
  licenseCode?: string;
  vehicleRestrictions?: string;
  [key: string]: string | undefined;
}

interface DocumentDetails {
  id: string;
  documentType: string;
  fileName: string;
  fileUrl: string;
  verificationStatus: 'pending' | 'verified' | 'rejected';
  ocrConfidence: number | null;
  ocrMetadata: OcrMetadata | null;
  notes: string | null;
  createdAt: string;
  staffName: string;
}

interface DocumentVerificationModalProps {
  documentId: string;
  staffId: string;
  staffName?: string;
  onSuccess: () => void;
  onClose: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  fullName: 'Full Name',
  idNumber: 'ID Number',
  documentNumber: 'License Number',
  dateOfBirth: 'Date of Birth',
  expiryDate: 'Expiry Date',
  licenseCode: 'License Code',
  vehicleRestrictions: 'Vehicle Restrictions',
  passportNumber: 'Passport Number',
  nationality: 'Nationality',
  placeOfBirth: 'Place of Birth',
  issueDate: 'Issue Date',
};

export function DocumentVerificationModal({
  documentId,
  staffId,
  staffName: propStaffName,
  onSuccess,
  onClose,
}: DocumentVerificationModalProps) {
  const [document, setDocument] = useState<DocumentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  // Fetch document details
  useEffect(() => {
    async function fetchDocument() {
      setLoading(true);
      try {
        const res = await fetch(`/api/staff-documents/${documentId}`);
        if (!res.ok) throw new Error('Failed to fetch document');
        const data = await res.json();
        setDocument(data.data);
      } catch (error) {
        log.error('Failed to fetch document', { error, documentId }, 'DocumentVerificationModal');
        toast.error('Failed to load document details');
        onClose();
      } finally {
        setLoading(false);
      }
    }

    fetchDocument();
  }, [documentId, onClose]);

  // Handle verify
  const handleVerify = useCallback(async () => {
    setVerifying(true);
    try {
      const res = await fetch(`/api/staff-documents/${documentId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffId,
          action: 'verify',
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to verify document');
      }

      toast.success('Document verified successfully');
      onSuccess();
    } catch (error) {
      log.error('Failed to verify document', { error, documentId, staffId }, 'DocumentVerificationModal');
      toast.error(error instanceof Error ? error.message : 'Failed to verify document');
    } finally {
      setVerifying(false);
    }
  }, [documentId, staffId, onSuccess]);

  // Handle reject
  const handleReject = useCallback(async () => {
    if (!rejectionReason.trim()) {
      toast.error('Please provide a rejection reason');
      return;
    }

    setRejecting(true);
    try {
      const res = await fetch(`/api/staff-documents/${documentId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffId,
          action: 'reject',
          reason: rejectionReason.trim(),
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to reject document');
      }

      toast.success('Document rejected');
      onSuccess();
    } catch (error) {
      log.error('Failed to reject document', { error, documentId, staffId, reason: rejectionReason }, 'DocumentVerificationModal');
      toast.error(error instanceof Error ? error.message : 'Failed to reject document');
    } finally {
      setRejecting(false);
    }
  }, [documentId, staffId, rejectionReason, onSuccess]);

  // Get display fields from OCR metadata
  const displayFields = document?.ocrMetadata
    ? Object.entries(document.ocrMetadata)
        .filter(([key, value]) => value && FIELD_LABELS[key])
        .map(([key, value]) => ({
          key,
          label: FIELD_LABELS[key],
          value: value as string,
        }))
    : [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--ff-bg-primary)] rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-[var(--ff-border-light)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-lg">
              <Shield className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                Verify Document
              </h3>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                {propStaffName || document?.staffName || 'Staff Member'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-[var(--ff-text-tertiary)] animate-spin" />
            </div>
          ) : document ? (
            <div className="space-y-6">
              {/* Document Preview */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
                {document.fileUrl && (
                  <div className="p-4 border-b border-[var(--ff-border-light)]">
                    {document.fileUrl.match(/\.(jpg|jpeg|png|gif)$/i) ? (
                      <img
                        src={document.fileUrl}
                        alt={document.fileName}
                        className="max-h-64 mx-auto object-contain rounded"
                      />
                    ) : (
                      <div className="flex items-center justify-center py-8 bg-[var(--ff-bg-tertiary)] rounded">
                        <FileText className="w-12 h-12 text-[var(--ff-text-tertiary)]" />
                      </div>
                    )}
                  </div>
                )}
                <div className="p-4">
                  <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                    {document.fileName}
                  </p>
                  <p className="text-xs text-[var(--ff-text-tertiary)]">
                    Uploaded: {new Date(document.createdAt).toLocaleString()}
                  </p>
                  {document.ocrConfidence !== null && (
                    <p className="text-xs text-[var(--ff-text-tertiary)]">
                      OCR Confidence: {Math.round(document.ocrConfidence * 100)}%
                    </p>
                  )}
                </div>
              </div>

              {/* Extracted Fields */}
              {displayFields.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-[var(--ff-text-primary)] flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Extracted Information
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    {displayFields.map((field) => (
                      <div
                        key={field.key}
                        className="p-3 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]"
                      >
                        <p className="text-xs text-[var(--ff-text-tertiary)] mb-1">
                          {field.label}
                        </p>
                        <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                          {field.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {displayFields.length === 0 && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-amber-500">
                        No OCR data extracted
                      </p>
                      <p className="text-xs text-amber-500/80 mt-1">
                        This document was uploaded without OCR extraction or the extraction failed.
                        You can still verify it based on manual review.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Rejection Form */}
              {showRejectForm && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-[var(--ff-text-primary)]">
                    Rejection Reason
                  </h4>
                  <textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Enter the reason for rejecting this document..."
                    rows={3}
                    className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:ring-2 focus:ring-red-500"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12">
              <AlertCircle className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
              <p className="text-[var(--ff-text-secondary)]">Document not found</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {document && (
          <div className="p-4 border-t border-[var(--ff-border-light)] shrink-0">
            {showRejectForm ? (
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => {
                    setShowRejectForm(false);
                    setRejectionReason('');
                  }}
                  disabled={rejecting}
                  className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors text-[var(--ff-text-primary)]"
                >
                  Back
                </button>
                <button
                  onClick={handleReject}
                  disabled={rejecting || !rejectionReason.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {rejecting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Rejecting...
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4" />
                      Confirm Reject
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowRejectForm(true)}
                  disabled={verifying}
                  className="flex items-center gap-2 px-4 py-2 border border-red-500 text-red-500 rounded-lg hover:bg-red-500/10 transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  Reject
                </button>
                <button
                  onClick={handleVerify}
                  disabled={verifying}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {verifying ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Verify Document
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
