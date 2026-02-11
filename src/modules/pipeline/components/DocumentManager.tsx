/**
 * Document Manager Component
 * Manages document uploads and displays for pipeline approvals
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileText,
  Upload,
  Trash2,
  CheckCircle,
  ExternalLink,
  Calendar,
  AlertTriangle,
  Loader2,
  X,
} from 'lucide-react';
import type {
  PipelineApprovalDocument,
  ApprovalDocumentType,
  UploadApprovalDocumentInput,
} from '../types';

interface DocumentManagerProps {
  approvalId: string;
  currentUserId?: string;
  readonly?: boolean;
  onDocumentChange?: () => void;
}

const DOCUMENT_TYPES: { value: ApprovalDocumentType; label: string }[] = [
  { value: 'application_form', label: 'Application Form' },
  { value: 'supporting_doc', label: 'Supporting Document' },
  { value: 'site_plan', label: 'Site Plan' },
  { value: 'route_map', label: 'Route Map' },
  { value: 'approval_certificate', label: 'Approval Certificate' },
  { value: 'rejection_letter', label: 'Rejection Letter' },
  { value: 'conditions_doc', label: 'Conditions Document' },
  { value: 'fee_receipt', label: 'Fee Receipt' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'appeal_doc', label: 'Appeal Document' },
  { value: 'other', label: 'Other' },
];

function formatDate(date: string | null | undefined): string {
  if (!date) return '-';
  // Standard YYYY-MM-DD format
  return new Date(date).toISOString().split('T')[0];
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isExpiringSoon(expiryDate: string | null | undefined): boolean {
  if (!expiryDate) return false;
  const daysUntilExpiry = Math.ceil(
    (new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
  return daysUntilExpiry > 0 && daysUntilExpiry <= 30;
}

function isExpired(expiryDate: string | null | undefined): boolean {
  if (!expiryDate) return false;
  return new Date(expiryDate) < new Date();
}

export function DocumentManager({
  approvalId,
  currentUserId,
  readonly = false,
  onDocumentChange,
}: DocumentManagerProps) {
  const [documents, setDocuments] = useState<PipelineApprovalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Upload form state
  const [uploadData, setUploadData] = useState({
    document_type: 'supporting_doc' as ApprovalDocumentType,
    document_name: '',
    description: '',
    file_url: '',
    file_name: '',
    file_size: undefined as number | undefined,
    document_date: new Date().toISOString().split('T')[0],
    issue_date: '',
    expiry_date: '',
    reference_number: '',
    issuing_authority: '',
  });

  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(file: File) {
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'pipeline');
      formData.append('category', 'approval-documents');
      const response = await fetch('/api/storage/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!response.ok) throw new Error('Upload failed');
      const data = await response.json();
      setUploadData((prev) => ({
        ...prev,
        file_url: data.url,
        file_name: prev.file_name || file.name,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'File upload failed');
    } finally {
      setUploadingFile(false);
    }
  }

  const fetchDocuments = useCallback(async () => {
    try {
      const response = await fetch(`/api/pipeline/approvals/${approvalId}/documents`);
      if (!response.ok) throw new Error('Failed to fetch documents');
      const data = await response.json();
      setDocuments(data.data?.documents || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [approvalId]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  async function handleUpload() {
    if (!uploadData.document_name || !uploadData.file_name) {
      setError('Document name and file name are required');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const input: Partial<UploadApprovalDocumentInput> = {
        document_type: uploadData.document_type,
        document_name: uploadData.document_name,
        description: uploadData.description || undefined,
        file_name: uploadData.file_name,
        file_url: uploadData.file_url || undefined,
        file_size: uploadData.file_size,
        document_date: uploadData.document_date || undefined,
        issue_date: uploadData.issue_date || undefined,
        expiry_date: uploadData.expiry_date || undefined,
        reference_number: uploadData.reference_number || undefined,
        issuing_authority: uploadData.issuing_authority || undefined,
        uploaded_by: currentUserId || 'unknown',
      };

      const response = await fetch(`/api/pipeline/approvals/${approvalId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!response.ok) throw new Error('Failed to upload document');

      await fetchDocuments();
      setShowUploadForm(false);
      setUploadData({
        document_type: 'supporting_doc',
        document_name: '',
        description: '',
        file_url: '',
        file_name: '',
        file_size: undefined,
        document_date: new Date().toISOString().split('T')[0],
        issue_date: '',
        expiry_date: '',
        reference_number: '',
        issuing_authority: '',
      });
      onDocumentChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(docId: string) {
    if (!confirm('Are you sure you want to delete this document?')) return;

    setDeleting(docId);
    setError(null);

    try {
      const response = await fetch(
        `/api/pipeline/approvals/${approvalId}/documents/${docId}`,
        { method: 'DELETE' }
      );

      if (!response.ok) throw new Error('Failed to delete document');

      await fetchDocuments();
      onDocumentChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete document');
    } finally {
      setDeleting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-text-secondary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Document List */}
      {documents.length > 0 ? (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-start gap-3 p-3 bg-[var(--ff-bg-secondary)] rounded-lg group"
            >
              <div className="flex-shrink-0 p-2 bg-[var(--ff-bg-primary)] rounded-lg">
                <FileText className="w-5 h-5 text-[var(--ff-accent)]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                    {doc.document_name}
                  </p>
                  {doc.is_verified && (
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                  )}
                  {isExpired(doc.expiry_date) && (
                    <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 rounded">
                      Expired
                    </span>
                  )}
                  {isExpiringSoon(doc.expiry_date) && !isExpired(doc.expiry_date) && (
                    <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Expiring
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--ff-text-secondary)] mt-0.5">
                  {DOCUMENT_TYPES.find((t) => t.value === doc.document_type)?.label || doc.document_type}
                  {doc.file_size && ` • ${formatFileSize(doc.file_size)}`}
                  {doc.reference_number && ` • Ref: ${doc.reference_number}`}
                </p>
                {doc.expiry_date && (
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-0.5 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Expires: {formatDate(doc.expiry_date)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {doc.file_url && (
                  <a
                    href={doc.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 hover:bg-[var(--ff-bg-primary)] rounded"
                    title="Open document"
                  >
                    <ExternalLink className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                  </a>
                )}
                {!readonly && (
                  <button
                    onClick={() => handleDelete(doc.id)}
                    disabled={deleting === doc.id}
                    className="p-1.5 hover:bg-red-50 rounded text-red-500 disabled:opacity-50"
                    title="Delete document"
                  >
                    {deleting === doc.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[var(--ff-text-tertiary)] text-center py-4">
          No documents uploaded yet
        </p>
      )}

      {/* Upload Button / Form */}
      {!readonly && !showUploadForm && (
        <button
          onClick={() => setShowUploadForm(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-secondary)] hover:border-[var(--ff-accent)] hover:text-[var(--ff-accent)] transition-colors"
        >
          <Upload className="w-4 h-4" />
          Add Document
        </button>
      )}

      {/* Upload Form */}
      {showUploadForm && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-[var(--ff-text-primary)]">
              Add Document
            </h4>
            <button
              onClick={() => setShowUploadForm(false)}
              className="p-1 hover:bg-[var(--ff-bg-primary)] rounded"
            >
              <X className="w-4 h-4 text-[var(--ff-text-secondary)]" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Document Name *
              </label>
              <input
                type="text"
                value={uploadData.document_name}
                onChange={(e) =>
                  setUploadData({ ...uploadData, document_name: e.target.value })
                }
                placeholder="e.g., Wayleave Application Form"
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] bg-[var(--ff-bg-primary)]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Document Type *
              </label>
              <select
                value={uploadData.document_type}
                onChange={(e) =>
                  setUploadData({
                    ...uploadData,
                    document_type: e.target.value as ApprovalDocumentType,
                  })
                }
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] bg-[var(--ff-bg-primary)]"
              >
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Reference Number
              </label>
              <input
                type="text"
                value={uploadData.reference_number}
                onChange={(e) =>
                  setUploadData({ ...uploadData, reference_number: e.target.value })
                }
                placeholder="e.g., WL-2024-001"
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] bg-[var(--ff-bg-primary)]"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                File Name *
              </label>
              <input
                type="text"
                value={uploadData.file_name}
                onChange={(e) =>
                  setUploadData({ ...uploadData, file_name: e.target.value })
                }
                placeholder="e.g., wayleave_application.pdf"
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] bg-[var(--ff-bg-primary)]"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                File URL
              </label>
              <input
                type="file"
                ref={fileInputRef}
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                  e.target.value = '';
                }}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingFile}
                  className="flex items-center gap-1.5 px-3 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-primary)] disabled:opacity-50 text-sm whitespace-nowrap"
                  title="Upload file"
                >
                  {uploadingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {uploadingFile ? 'Uploading...' : 'Upload'}
                </button>
                <input
                  type="url"
                  value={uploadData.file_url}
                  onChange={(e) =>
                    setUploadData({ ...uploadData, file_url: e.target.value })
                  }
                  placeholder="https://... or upload a file"
                  className="flex-1 px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] bg-[var(--ff-bg-primary)]"
                />
              </div>
              <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                Upload a file or paste a URL
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Issue Date
              </label>
              <input
                type="date"
                value={uploadData.issue_date}
                onChange={(e) =>
                  setUploadData({ ...uploadData, issue_date: e.target.value })
                }
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] bg-[var(--ff-bg-primary)]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Expiry Date
              </label>
              <input
                type="date"
                value={uploadData.expiry_date}
                onChange={(e) =>
                  setUploadData({ ...uploadData, expiry_date: e.target.value })
                }
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] bg-[var(--ff-bg-primary)]"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Issuing Authority
              </label>
              <input
                type="text"
                value={uploadData.issuing_authority}
                onChange={(e) =>
                  setUploadData({ ...uploadData, issuing_authority: e.target.value })
                }
                placeholder="e.g., City of Johannesburg"
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] bg-[var(--ff-bg-primary)]"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Description
              </label>
              <textarea
                value={uploadData.description}
                onChange={(e) =>
                  setUploadData({ ...uploadData, description: e.target.value })
                }
                rows={2}
                placeholder="Optional description..."
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] bg-[var(--ff-bg-primary)]"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleUpload}
              disabled={uploading || !uploadData.document_name || !uploadData.file_name}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-[var(--ff-accent)] text-white rounded-lg hover:bg-[var(--ff-accent-hover)] disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Add Document
                </>
              )}
            </button>
            <button
              onClick={() => setShowUploadForm(false)}
              disabled={uploading}
              className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-primary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DocumentManager;
