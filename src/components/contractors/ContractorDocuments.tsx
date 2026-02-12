'use client';

/**
 * Contractor Documents
 * Main component for document management on contractor detail page
 */

import { useState, useEffect } from 'react';
import { Plus, FileText, RefreshCw, FileDown } from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import { ContractorDocument } from '@/types/contractor-document.types';
import { DocumentCard } from './DocumentCard';
import { DocumentUploadForm } from './DocumentUploadForm';
import { GenerateAgreementModal } from './GenerateAgreementModal';
import { log } from '@/lib/logger';

interface ContractorDocumentsProps {
  contractorId: string;
}

export function ContractorDocuments({ contractorId }: ContractorDocumentsProps) {
  const [documents, setDocuments] = useState<ContractorDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [showAgreementModal, setShowAgreementModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch documents
  const fetchDocuments = async () => {
    try {
      setError(null);
      const response = await fetch(`/api/contractors-documents?contractorId=${contractorId}`);

      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }

      const data = await response.json();
      setDocuments(data.data || []);
    } catch (err: any) {
      log.error('Failed to fetch documents', { error: err }, 'ContractorDocuments');
      setError(err.message || 'Failed to load documents');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchDocuments();
  }, [contractorId]);

  // Handle refresh
  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchDocuments();
  };

  // Handle upload success
  const handleUploadSuccess = () => {
    setShowUploadForm(false);
    fetchDocuments();
  };

  // Handle delete
  const handleDelete = async (documentId: string) => {
    try {
      const response = await fetch('/api/contractors-documents-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: documentId }),
      });

      if (!response.ok) {
        throw new Error('Failed to delete document');
      }

      // Remove from local state
      setDocuments(docs => docs.filter(d => d.id !== documentId));
      notificationService.success('Document deleted');

    } catch (err: unknown) {
      log.error('Failed to delete document', { error: err }, 'ContractorDocuments');
      const message = err instanceof Error ? err.message : 'Failed to delete document';
      notificationService.error(message);
    }
  };

  // Handle verify
  const handleVerify = async (documentId: string, action: 'approve' | 'reject') => {
    try {
      const response = await fetch('/api/contractors-documents-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: documentId,
          action,
          verifiedBy: 'current-user@fibreflow.com', // TODO: Get from auth
          verificationNotes: action === 'approve' ? 'Document approved' : undefined,
          rejectionReason: action === 'reject' ? 'Document rejected by admin' : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${action} document`);
      }

      // Refresh documents
      fetchDocuments();
      notificationService.success(`Document ${action === 'approve' ? 'approved' : 'rejected'}`);

    } catch (err: unknown) {
      log.error(`Failed to ${action} document`, { error: err }, 'ContractorDocuments');
      const message = err instanceof Error ? err.message : `Failed to ${action} document`;
      notificationService.error(message);
    }
  };

  // Group documents by status for better organization
  const groupedDocuments = {
    approved: documents.filter(d => d.status === 'approved'),
    pending: documents.filter(d => d.status === 'pending'),
    rejected: documents.filter(d => d.status === 'rejected'),
    expired: documents.filter(d => d.isExpired),
  };

  const hasExpired = groupedDocuments.expired.length > 0;
  const hasPending = groupedDocuments.pending.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[var(--ff-text-primary)]">Documents</h2>
          <p className="text-[var(--ff-text-secondary)] mt-1">
            Manage contractor documents, certificates, and compliance records
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="p-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] rounded-lg transition-colors disabled:opacity-50"
            title="Refresh documents"
          >
            <RefreshCw className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>

          {/* Generate Agreement Button */}
          <button
            onClick={() => setShowAgreementModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            title="Generate Master Build Agreement"
          >
            <FileDown className="h-4 w-4" />
            Generate Agreement
          </button>

          {/* Upload Button */}
          <button
            onClick={() => setShowUploadForm(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Upload Document
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <FileText className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{documents.length}</p>
              <p className="text-sm text-[var(--ff-text-secondary)]">Total Documents</p>
            </div>
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <FileText className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{groupedDocuments.approved.length}</p>
              <p className="text-sm text-[var(--ff-text-secondary)]">Approved</p>
            </div>
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-500/20 rounded-lg">
              <FileText className="h-5 w-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{groupedDocuments.pending.length}</p>
              <p className="text-sm text-[var(--ff-text-secondary)]">Pending Review</p>
            </div>
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/20 rounded-lg">
              <FileText className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{groupedDocuments.expired.length}</p>
              <p className="text-sm text-[var(--ff-text-secondary)]">Expired</p>
            </div>
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
          <p className="font-medium">Error loading documents</p>
          <p className="text-sm mt-1">{error}</p>
          <button
            onClick={fetchDocuments}
            className="mt-2 text-sm underline hover:no-underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && documents.length === 0 && (
        <div className="text-center py-12 bg-[var(--ff-bg-tertiary)] rounded-lg border-2 border-dashed border-[var(--ff-border-light)]">
          <FileText className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
          <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">No documents uploaded</h3>
          <p className="text-[var(--ff-text-secondary)] mb-4">
            Upload documents like insurance certificates, registrations, and compliance records
          </p>
          <button
            onClick={() => setShowUploadForm(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Upload First Document
          </button>
        </div>
      )}

      {/* Documents List */}
      {!isLoading && !error && documents.length > 0 && (
        <div className="space-y-6">
          {/* Expired Documents (Show First - High Priority) */}
          {hasExpired && (
            <div>
              <h3 className="text-lg font-semibold text-red-400 mb-3 flex items-center gap-2">
                ⚠️ Expired Documents ({groupedDocuments.expired.length})
              </h3>
              <div className="space-y-3">
                {groupedDocuments.expired.map(doc => (
                  <DocumentCard
                    key={doc.id}
                    document={doc}
                    onDelete={handleDelete}
                    onVerify={handleVerify}
                    showVerifyButtons={false}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Pending Documents */}
          {hasPending && (
            <div>
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-3">
                Pending Review ({groupedDocuments.pending.length})
              </h3>
              <div className="space-y-3">
                {groupedDocuments.pending.map(doc => (
                  <DocumentCard
                    key={doc.id}
                    document={doc}
                    onDelete={handleDelete}
                    onVerify={handleVerify}
                    showVerifyButtons={true}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Approved Documents */}
          {groupedDocuments.approved.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-3">
                Approved Documents ({groupedDocuments.approved.length})
              </h3>
              <div className="space-y-3">
                {groupedDocuments.approved.map(doc => (
                  <DocumentCard
                    key={doc.id}
                    document={doc}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Rejected Documents */}
          {groupedDocuments.rejected.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-3">
                Rejected Documents ({groupedDocuments.rejected.length})
              </h3>
              <div className="space-y-3">
                {groupedDocuments.rejected.map(doc => (
                  <DocumentCard
                    key={doc.id}
                    document={doc}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadForm && (
        <DocumentUploadForm
          contractorId={contractorId}
          onSuccess={handleUploadSuccess}
          onCancel={() => setShowUploadForm(false)}
        />
      )}

      {/* Generate Agreement Modal */}
      {showAgreementModal && (
        <GenerateAgreementModal
          contractorId={contractorId}
          onClose={() => setShowAgreementModal(false)}
        />
      )}
    </div>
  );
}
