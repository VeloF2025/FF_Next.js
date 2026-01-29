'use client';

/**
 * Contractor Documents
 * Main component for document management on contractor detail page
 */

import { useState, useEffect } from 'react';
import { Plus, FileText, RefreshCw, FileDown, Loader2 } from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import { ContractorDocument } from '@/types/contractor-document.types';
import { DocumentCard } from './DocumentCard';
import { DocumentUploadForm } from './DocumentUploadForm';

interface ContractorDocumentsProps {
  contractorId: string;
}

export function ContractorDocuments({ contractorId }: ContractorDocumentsProps) {
  const [documents, setDocuments] = useState<ContractorDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

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
      console.error('Fetch error:', err);
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
      console.error('Delete error:', err);
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
      console.error('Verify error:', err);
      const message = err instanceof Error ? err.message : `Failed to ${action} document`;
      notificationService.error(message);
    }
  };

  // Handle generate Master Build Agreement
  const handleGenerateAgreement = async () => {
    try {
      setIsGenerating(true);

      const response = await fetch('/api/documents/generate-master-build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractorId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate document');
      }

      // Get the filename from content-disposition header
      const contentDisposition = response.headers.get('content-disposition');
      const filenameMatch = contentDisposition?.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] || 'master-build-agreement.docx';

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      notificationService.success('Master Build Agreement generated');
    } catch (err: unknown) {
      console.error('Generate error:', err);
      const message = err instanceof Error ? err.message : 'Failed to generate document';
      notificationService.error(message);
    } finally {
      setIsGenerating(false);
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
          <h2 className="text-2xl font-bold text-gray-900">Documents</h2>
          <p className="text-gray-600 mt-1">
            Manage contractor documents, certificates, and compliance records
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh documents"
          >
            <RefreshCw className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>

          {/* Generate Agreement Button */}
          <button
            onClick={handleGenerateAgreement}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
            title="Generate Master Build Agreement"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            {isGenerating ? 'Generating...' : 'Generate Agreement'}
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
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg">
              <FileText className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{documents.length}</p>
              <p className="text-sm text-gray-600">Total Documents</p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-50 rounded-lg">
              <FileText className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{groupedDocuments.approved.length}</p>
              <p className="text-sm text-gray-600">Approved</p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-50 rounded-lg">
              <FileText className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{groupedDocuments.pending.length}</p>
              <p className="text-sm text-gray-600">Pending Review</p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-50 rounded-lg">
              <FileText className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{groupedDocuments.expired.length}</p>
              <p className="text-sm text-gray-600">Expired</p>
            </div>
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
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
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No documents uploaded</h3>
          <p className="text-gray-600 mb-4">
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
              <h3 className="text-lg font-semibold text-red-900 mb-3 flex items-center gap-2">
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
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
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
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
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
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
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
    </div>
  );
}
