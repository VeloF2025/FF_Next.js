'use client';

/**
 * Staff Document List
 * Displays and manages staff documents with filtering and actions
 */

import { useState, useEffect } from 'react';
import {
  FileText,
  Download,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Plus,
  Filter,
  Eye,
  Shield,
  Search,
} from 'lucide-react';
import {
  StaffDocument,
  DocumentType,
  VerificationStatus,
  DOCUMENT_TYPE_LABELS,
  VERIFICATION_STATUS_LABELS,
  VERIFICATION_STATUS_COLORS,
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
} from '@/types/staff-document.types';
import { StaffDocumentUploadForm } from './StaffDocumentUploadForm';
import { createLogger } from '@/lib/logger';

const logger = createLogger('StaffDocumentList');

interface StaffDocumentListProps {
  staffId: string;
  isAdmin?: boolean;
  onVerify?: (documentId: string, status: 'verified' | 'rejected', notes?: string) => void;
}

export function StaffDocumentList({ staffId, isAdmin = false, onVerify }: StaffDocumentListProps) {
  const [documents, setDocuments] = useState<StaffDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchDocuments = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/staff/${staffId}/documents`);
      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }
      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errMsg);
      logger.error('Failed to fetch documents', { staffId, error: errMsg });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [staffId]);

  const handleDelete = async (documentId: string) => {
    if (!confirm('Are you sure you want to delete this document?')) {
      return;
    }

    setDeletingId(documentId);
    try {
      const response = await fetch(`/api/staff-documents/${documentId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete document');
      }

      setDocuments((prev) => prev.filter((d) => d.id !== documentId));
      logger.info('Document deleted', { documentId });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errMsg);
      logger.error('Failed to delete document', { documentId, error: errMsg });
    } finally {
      setDeletingId(null);
    }
  };

  const handleUploadSuccess = () => {
    setShowUploadForm(false);
    fetchDocuments();
  };

  // Filter documents
  const filteredDocuments = documents.filter((doc) => {
    // Category filter
    if (selectedCategory !== 'all') {
      const categoryTypes = DOCUMENT_CATEGORIES[selectedCategory as keyof typeof DOCUMENT_CATEGORIES];
      if (!categoryTypes?.includes(doc.documentType)) {
        return false;
      }
    }

    // Status filter
    if (selectedStatus !== 'all' && doc.verificationStatus !== selectedStatus) {
      return false;
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        doc.documentName.toLowerCase().includes(query) ||
        DOCUMENT_TYPE_LABELS[doc.documentType].toLowerCase().includes(query) ||
        doc.documentNumber?.toLowerCase().includes(query)
      );
    }

    return true;
  });

  // Get status badge
  const getStatusBadge = (status: VerificationStatus) => {
    const color = VERIFICATION_STATUS_COLORS[status];
    const label = VERIFICATION_STATUS_LABELS[status];

    const colorClasses: Record<string, string> = {
      pending: 'bg-yellow-500/20 text-yellow-400',
      verified: 'bg-green-500/20 text-green-400',
      rejected: 'bg-red-500/20 text-red-400',
      expired: 'bg-gray-500/20 text-gray-400',
    };

    const icons: Record<VerificationStatus, React.ReactNode> = {
      pending: <Clock className="h-3 w-3" />,
      verified: <CheckCircle className="h-3 w-3" />,
      rejected: <XCircle className="h-3 w-3" />,
      expired: <AlertTriangle className="h-3 w-3" />,
    };

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${colorClasses[status]}`}>
        {icons[status]}
        {label}
      </span>
    );
  };

  // Calculate days until expiry
  const getDaysUntilExpiry = (expiryDate: string): number | null => {
    if (!expiryDate) return null;
    const expiry = new Date(expiryDate);
    const now = new Date();
    const diff = expiry.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  // Get expiry warning
  const getExpiryWarning = (expiryDate?: string) => {
    if (!expiryDate) return null;
    const days = getDaysUntilExpiry(expiryDate);
    if (days === null) return null;

    if (days < 0) {
      return <span className="text-xs text-red-600 font-medium">Expired {Math.abs(days)} days ago</span>;
    }
    if (days <= 7) {
      return <span className="text-xs text-red-600 font-medium">Expires in {days} days</span>;
    }
    if (days <= 30) {
      return <span className="text-xs text-amber-600 font-medium">Expires in {days} days</span>;
    }
    return null;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Documents</h3>
        <button
          onClick={() => setShowUploadForm(true)}
          className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Upload Document
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-4 ff-bg-tertiary rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-[var(--ff-text-secondary)]" />
          <span className="text-sm text-[var(--ff-text-secondary)]">Filter:</span>
        </div>

        {/* Category filter */}
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="text-sm border border-[var(--ff-border-light)] rounded-md px-2 py-1 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
        >
          <option value="all">All Categories</option>
          {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="text-sm border border-[var(--ff-border-light)] rounded-md px-2 py-1 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
        >
          <option value="all">All Status</option>
          {Object.entries(VERIFICATION_STATUS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-secondary)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search documents..."
            className="w-full pl-8 pr-3 py-1 text-sm border border-[var(--ff-border-light)] rounded-md bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Document list */}
      {filteredDocuments.length === 0 ? (
        <div className="text-center py-12 ff-bg-tertiary rounded-lg">
          <FileText className="h-12 w-12 text-[var(--ff-text-secondary)] mx-auto mb-3" />
          <p className="text-[var(--ff-text-secondary)]">No documents found</p>
          {documents.length > 0 && (
            <p className="text-sm text-[var(--ff-text-secondary)] opacity-70 mt-1">Try adjusting your filters</p>
          )}
        </div>
      ) : (
        <div className="divide-y divide-[var(--ff-border-light)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          {filteredDocuments.map((doc) => (
            <div key={doc.id} className="p-4 bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-hover)] transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <div className="p-2 bg-[var(--ff-bg-tertiary)] rounded-lg">
                    <FileText className="h-5 w-5 text-[var(--ff-text-secondary)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-medium text-[var(--ff-text-primary)] truncate">{doc.documentName}</h4>
                      {getStatusBadge(doc.verificationStatus)}
                    </div>
                    <p className="text-xs text-[var(--ff-text-secondary)] mt-0.5">{DOCUMENT_TYPE_LABELS[doc.documentType]}</p>
                    {doc.documentNumber && (
                      <p className="text-xs text-[var(--ff-text-secondary)] opacity-70 mt-0.5">#{doc.documentNumber}</p>
                    )}
                    {getExpiryWarning(doc.expiryDate)}
                    {doc.expiryDate && !getExpiryWarning(doc.expiryDate) && (
                      <p className="text-xs text-[var(--ff-text-secondary)] opacity-70 mt-0.5">
                        Expires: {new Date(doc.expiryDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <a
                    href={`/api/staff-documents-download?documentId=${doc.id}&inline=true`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 text-[var(--ff-text-secondary)] hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                    title="View"
                  >
                    <Eye className="h-4 w-4" />
                  </a>
                  <a
                    href={`/api/staff-documents-download?documentId=${doc.id}`}
                    download
                    className="p-2 text-[var(--ff-text-secondary)] hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                  {isAdmin && doc.verificationStatus === 'pending' && onVerify && (
                    <button
                      onClick={() => onVerify(doc.id, 'verified')}
                      className="p-2 text-[var(--ff-text-secondary)] hover:text-green-400 hover:bg-green-500/10 rounded-lg transition-colors"
                      title="Verify"
                    >
                      <Shield className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(doc.id)}
                    disabled={deletingId === doc.id}
                    className="p-2 text-[var(--ff-text-secondary)] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                    title="Delete"
                  >
                    {deletingId === doc.id ? (
                      <div className="animate-spin h-4 w-4 border-2 border-red-600 border-t-transparent rounded-full" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Summary */}
      <div className="flex items-center gap-4 text-sm text-[var(--ff-text-secondary)]">
        <span>
          {filteredDocuments.length} of {documents.length} documents
        </span>
        <span>•</span>
        <span className="text-green-400">
          {documents.filter((d) => d.verificationStatus === 'verified').length} verified
        </span>
        <span className="text-yellow-400">
          {documents.filter((d) => d.verificationStatus === 'pending').length} pending
        </span>
      </div>

      {/* Upload form modal */}
      {showUploadForm && (
        <StaffDocumentUploadForm
          staffId={staffId}
          onSuccess={handleUploadSuccess}
          onCancel={() => setShowUploadForm(false)}
        />
      )}
    </div>
  );
}
