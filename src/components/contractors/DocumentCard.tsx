'use client';

/**
 * Document Card
 * Displays a single contractor document with actions
 */

import { useState } from 'react';
import { FileText, Download, Trash2, Check, X, Clock, AlertTriangle, ExternalLink } from 'lucide-react';
import { ContractorDocument, DOCUMENT_TYPE_LABELS, STATUS_COLORS } from '@/types/contractor-document.types';

interface DocumentCardProps {
  document: ContractorDocument;
  onDelete: (documentId: string) => void;
  onVerify?: (documentId: string, action: 'approve' | 'reject') => void;
  showVerifyButtons?: boolean;
}

export function DocumentCard({ document, onDelete, onVerify, showVerifyButtons = false }: DocumentCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete "${document.documentName}"?`)) {
      return;
    }

    setIsDeleting(true);
    try {
      await onDelete(document.id);
    } catch (error) {
      console.error('Delete failed:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDownload = () => {
    window.open(document.fileUrl, '_blank');
  };

  // Calculate expiry warning
  const isExpiringSoon = document.daysUntilExpiry !== undefined &&
                         document.daysUntilExpiry > 0 &&
                         document.daysUntilExpiry <= 30;

  const isExpired = document.isExpired ||
                    (document.daysUntilExpiry !== undefined && document.daysUntilExpiry < 0);

  // Status badge color
  const getStatusColor = () => {
    const colorMap = STATUS_COLORS[document.status];
    switch (colorMap) {
      case 'green': return 'bg-green-500/20 text-green-400';
      case 'yellow': return 'bg-yellow-500/20 text-yellow-400';
      case 'red': return 'bg-red-500/20 text-red-400';
      case 'gray': return 'bg-gray-500/20 text-gray-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] hover:shadow-md transition-shadow p-4">
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="flex-shrink-0">
          <div className={`p-3 rounded-lg ${
            isExpired ? 'bg-red-50' :
            isExpiringSoon ? 'bg-yellow-50' :
            'bg-blue-50'
          }`}>
            <FileText className={`h-6 w-6 ${
              isExpired ? 'text-red-600' :
              isExpiringSoon ? 'text-yellow-600' :
              'text-blue-600'
            }`} />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-2">
            <div className="flex-1">
              <h3 className="font-semibold text-[var(--ff-text-primary)]">{document.documentName}</h3>
              <p className="text-sm text-[var(--ff-text-secondary)] mt-0.5">
                {DOCUMENT_TYPE_LABELS[document.documentType]}
              </p>
            </div>

            {/* Status Badge */}
            <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor()}`}>
              {document.status.toUpperCase()}
            </span>
          </div>

          {/* Details */}
          <div className="space-y-1 text-sm text-[var(--ff-text-secondary)] mb-3">
            {document.documentNumber && (
              <div>
                <span className="font-medium">Number:</span> {document.documentNumber}
              </div>
            )}

            {document.expiryDate && (
              <div className={`flex items-center gap-1 ${
                isExpired ? 'text-red-600 font-medium' :
                isExpiringSoon ? 'text-yellow-700 font-medium' :
                ''
              }`}>
                <Clock className="h-3.5 w-3.5" />
                {isExpired ? (
                  <span>Expired {new Date(document.expiryDate).toLocaleDateString()}</span>
                ) : isExpiringSoon ? (
                  <span>Expires in {document.daysUntilExpiry} days ({new Date(document.expiryDate).toLocaleDateString()})</span>
                ) : (
                  <span>Expires {new Date(document.expiryDate).toLocaleDateString()}</span>
                )}
              </div>
            )}

            <div className="text-xs text-[var(--ff-text-tertiary)]">
              Uploaded {new Date(document.createdAt).toLocaleDateString()} • {
                document.fileSize
                  ? `${(document.fileSize / 1024 / 1024).toFixed(2)} MB`
                  : 'Size unknown'
              }
            </div>
          </div>

          {/* Expiry Warning */}
          {isExpiringSoon && !isExpired && (
            <div className="mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-800">
                Document expiring soon! Please upload a new version.
              </p>
            </div>
          )}

          {/* Expired Warning */}
          {isExpired && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-800 font-medium">
                Document expired! Please upload a new version immediately.
              </p>
            </div>
          )}

          {/* Verification Info */}
          {document.isVerified && document.verifiedBy && (
            <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded flex items-start gap-2">
              <Check className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-green-800">
                <p className="font-medium">Verified by {document.verifiedBy}</p>
                {document.verifiedAt && (
                  <p className="mt-0.5">on {new Date(document.verifiedAt).toLocaleString()}</p>
                )}
                {document.verificationNotes && (
                  <p className="mt-1 italic">{document.verificationNotes}</p>
                )}
              </div>
            </div>
          )}

          {/* Rejection Info */}
          {document.status === 'rejected' && document.rejectionReason && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded flex items-start gap-2">
              <X className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-red-800">
                <p className="font-medium">Rejected</p>
                <p className="mt-1">{document.rejectionReason}</p>
              </div>
            </div>
          )}

          {/* Notes */}
          {document.notes && (
            <div className="text-xs text-[var(--ff-text-secondary)] italic border-l-2 border-[var(--ff-border-light)] pl-2 mb-3">
              {document.notes}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-[var(--ff-border-light)]">
            {/* Download */}
            <button
              onClick={handleDownload}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
              title="Download document"
            >
              <Download className="h-4 w-4" />
              Download
            </button>

            {/* View */}
            <a
              href={document.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] rounded transition-colors"
              title="View in new tab"
            >
              <ExternalLink className="h-4 w-4" />
              View
            </a>

            {/* Verify Buttons (Admin only) */}
            {showVerifyButtons && !document.isVerified && document.status === 'pending' && onVerify && (
              <>
                <button
                  onClick={() => onVerify(document.id, 'approve')}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-green-600 hover:bg-green-50 rounded transition-colors"
                  title="Approve document"
                >
                  <Check className="h-4 w-4" />
                  Approve
                </button>
                <button
                  onClick={() => onVerify(document.id, 'reject')}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded transition-colors"
                  title="Reject document"
                >
                  <X className="h-4 w-4" />
                  Reject
                </button>
              </>
            )}

            {/* Delete */}
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="ml-auto flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
              title="Delete document"
            >
              <Trash2 className="h-4 w-4" />
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
