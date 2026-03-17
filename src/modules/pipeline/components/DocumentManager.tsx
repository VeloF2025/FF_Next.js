/**
 * Document Manager Component
 * Manages document uploads and displays for pipeline approvals
 * Supports multi-file upload: select multiple files at once, each gets its own record
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

interface UploadedFile {
  id: string;
  document_name: string;
  file_name: string;
  file_url: string;
  file_size?: number;
  uploading: boolean;
  error?: string;
}

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

  // Upload form state — shared metadata for all files in a batch
  const [uploadMeta, setUploadMeta] = useState({
    document_type: 'supporting_doc' as ApprovalDocumentType,
    description: '',
    document_date: new Date().toISOString().split('T')[0],
    issue_date: '',
    expiry_date: '',
    reference_number: '',
    issuing_authority: '',
  });

  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function fileNameWithoutExt(name: string): string {
    return name.replace(/\.[^.]+$/, '');
  }

  async function handleFilesSelect(files: FileList) {
    setUploadingFiles(true);
    setError(null);

    const newFiles: UploadedFile[] = Array.from(files).map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      document_name: fileNameWithoutExt(f.name),
      file_name: f.name,
      file_url: '',
      file_size: f.size,
      uploading: true,
    }));

    setUploadedFiles((prev) => [...prev, ...newFiles]);

    await Promise.all(
      Array.from(files).map(async (file, idx) => {
        const entry = newFiles[idx];
        if (!entry) return;
        const fileId = entry.id;
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
          if (!response.ok) {
            const errData = await response.json().catch(() => null);
            throw new Error(errData?.error || 'Upload failed');
          }
          const data = await response.json();
          setUploadedFiles((prev) =>
            prev.map((f) =>
              f.id === fileId ? { ...f, file_url: data.url, uploading: false } : f
            )
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Upload failed';
          setUploadedFiles((prev) =>
            prev.map((f) =>
              f.id === fileId ? { ...f, uploading: false, error: msg } : f
            )
          );
        }
      })
    );

    setUploadingFiles(false);
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
    const readyFiles = uploadedFiles.filter((f) => f.file_url && !f.error);
    if (readyFiles.length === 0) {
      setError('Please upload at least one file');
      return;
    }

    const missingNames = readyFiles.some((f) => !f.document_name.trim());
    if (missingNames) {
      setError('All files need a document name');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const results = await Promise.all(
        readyFiles.map(async (file) => {
          const input: Partial<UploadApprovalDocumentInput> = {
            document_type: uploadMeta.document_type,
            document_name: file.document_name,
            description: uploadMeta.description || undefined,
            file_name: file.file_name,
            file_url: file.file_url || undefined,
            file_size: file.file_size,
            document_date: uploadMeta.document_date || undefined,
            issue_date: uploadMeta.issue_date || undefined,
            expiry_date: uploadMeta.expiry_date || undefined,
            reference_number: uploadMeta.reference_number || undefined,
            issuing_authority: uploadMeta.issuing_authority || undefined,
            uploaded_by: currentUserId || 'unknown',
          };

          const response = await fetch(`/api/pipeline/approvals/${approvalId}/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          });

          if (!response.ok) throw new Error(`Failed to save ${file.document_name}`);
          return response;
        })
      );

      if (results.some((r) => !r.ok)) {
        throw new Error('Some documents failed to save');
      }

      await fetchDocuments();
      setShowUploadForm(false);
      setUploadedFiles([]);
      setUploadMeta({
        document_type: 'supporting_doc',
        description: '',
        document_date: new Date().toISOString().split('T')[0],
        issue_date: '',
        expiry_date: '',
        reference_number: '',
        issuing_authority: '',
      });
      onDocumentChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload documents');
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
              <div className="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
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

          <div className="space-y-4">
            {/* File Upload Area */}
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Files *
              </label>
              <input
                type="file"
                ref={fileInputRef}
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleFilesSelect(e.target.files);
                  }
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFiles}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-[var(--ff-border-light)] rounded-lg hover:border-[var(--ff-accent)] hover:text-[var(--ff-accent)] transition-colors disabled:opacity-50 text-sm"
              >
                {uploadingFiles ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Uploading files...</>
                ) : (
                  <><Upload className="w-4 h-4" /> Select files (multiple allowed)</>
                )}
              </button>

              {/* Uploaded Files List */}
              {uploadedFiles.length > 0 && (
                <div className="mt-2 space-y-2">
                  {uploadedFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center gap-2 p-2 bg-[var(--ff-bg-primary)] rounded-lg"
                    >
                      {file.uploading ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[var(--ff-accent)] flex-shrink-0" />
                      ) : file.error ? (
                        <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                      ) : (
                        <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                      )}
                      <input
                        type="text"
                        value={file.document_name}
                        onChange={(e) =>
                          setUploadedFiles((prev) =>
                            prev.map((f) =>
                              f.id === file.id ? { ...f, document_name: e.target.value } : f
                            )
                          )
                        }
                        className="flex-1 px-2 py-1 text-sm border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--ff-accent)]"
                        placeholder="Document name"
                        title="Edit document name"
                      />
                      <span className="text-xs text-[var(--ff-text-tertiary)] whitespace-nowrap">
                        {file.file_name}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setUploadedFiles((prev) => prev.filter((f) => f.id !== file.id))
                        }
                        className="p-1 hover:bg-red-50 rounded text-red-400 hover:text-red-600"
                        title="Remove file"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <p className="text-xs text-[var(--ff-text-tertiary)]">
                    {uploadedFiles.filter((f) => f.file_url && !f.error).length} of{' '}
                    {uploadedFiles.length} file(s) ready
                  </p>
                </div>
              )}
            </div>

            {/* Shared metadata fields */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Document Type *
                </label>
                <select
                  value={uploadMeta.document_type}
                  onChange={(e) =>
                    setUploadMeta({
                      ...uploadMeta,
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
                  value={uploadMeta.reference_number}
                  onChange={(e) =>
                    setUploadMeta({ ...uploadMeta, reference_number: e.target.value })
                  }
                  placeholder="e.g., WL-2024-001"
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] bg-[var(--ff-bg-primary)]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Issue Date
                </label>
                <input
                  type="date"
                  value={uploadMeta.issue_date}
                  onChange={(e) =>
                    setUploadMeta({ ...uploadMeta, issue_date: e.target.value })
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
                  value={uploadMeta.expiry_date}
                  onChange={(e) =>
                    setUploadMeta({ ...uploadMeta, expiry_date: e.target.value })
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
                  value={uploadMeta.issuing_authority}
                  onChange={(e) =>
                    setUploadMeta({ ...uploadMeta, issuing_authority: e.target.value })
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
                  value={uploadMeta.description}
                  onChange={(e) =>
                    setUploadMeta({ ...uploadMeta, description: e.target.value })
                  }
                  rows={2}
                  placeholder="Optional description..."
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] bg-[var(--ff-bg-primary)]"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleUpload}
              disabled={uploading || uploadingFiles || uploadedFiles.filter((f) => f.file_url && !f.error).length === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-[var(--ff-accent)] text-white rounded-lg hover:bg-[var(--ff-accent-hover)] disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  {uploadedFiles.filter((f) => f.file_url && !f.error).length <= 1
                    ? 'Add Document'
                    : `Add ${uploadedFiles.filter((f) => f.file_url && !f.error).length} Documents`}
                </>
              )}
            </button>
            <button
              onClick={() => {
                setShowUploadForm(false);
                setUploadedFiles([]);
              }}
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
