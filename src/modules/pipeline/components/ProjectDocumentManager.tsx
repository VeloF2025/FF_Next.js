/**
 * Project Document Manager Component
 * Full document management for pipeline projects - view, upload, delete
 * Supports marking documents as "required" (compulsory) for the project
 */

'use client';

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
  FolderOpen,
  Search,
  Shield,
  Star,
} from 'lucide-react';

interface Document {
  id: string;
  pipeline_project_id: string;
  approval_id: string | null;
  document_type: string;
  document_name: string;
  description: string | null;
  file_name: string;
  file_path: string | null;
  file_url: string | null;
  file_size: number | null;
  mime_type: string | null;
  document_date: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  reference_number: string | null;
  issuing_authority: string | null;
  is_verified: boolean;
  is_required: boolean;
  uploaded_by: string | null;
  created_at: string;
  smartsheet_attachment_id: string | null;
  approval_type_name: string | null;
  approval_type_code: string | null;
}

interface ProjectDocumentManagerProps {
  projectId: string;
  projectName?: string;
  currentUserId?: string;
  readonly?: boolean;
}

const DOCUMENT_TYPES: { value: string; label: string }[] = [
  { value: 'approval_certificate', label: 'Approval Certificate' },
  { value: 'application_form', label: 'Application Form' },
  { value: 'site_plan', label: 'Site Plan / Map' },
  { value: 'conditions_doc', label: 'Conditions Document' },
  { value: 'fee_receipt', label: 'Fee Receipt' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'supporting_doc', label: 'Supporting Document' },
  { value: 'other', label: 'Other' },
];

function formatDate(date: string | null | undefined): string {
  if (!date) return '-';
  return new Date(date).toISOString().split('T')[0] ?? '-';
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

function getDocTypeIcon(docType: string): string {
  const icons: Record<string, string> = {
    approval_certificate: '✅',
    application_form: '📝',
    site_plan: '🗺️',
    conditions_doc: '📋',
    fee_receipt: '🧾',
    correspondence: '📧',
    supporting_doc: '📎',
  };
  return icons[docType] || '📄';
}

/**
 * Convert document URL to proxy URL for viewing
 */
function getDocumentViewUrl(fileUrl: string | null, filePath: string | null): string | null {
  if (!fileUrl && !filePath) return null;

  if (filePath) {
    return `/api/pipeline/documents/${filePath}`;
  }

  if (!fileUrl) return null;

  const storagePatterns = [
    /https?:\/\/vf\.fibreflow\.app\/(pipeline\/[^/]+\/.+)$/,
    /https?:\/\/dev\.fibreflow\.app\/(pipeline\/[^/]+\/.+)$/,
    /https?:\/\/app\.fibreflow\.app\/(pipeline\/[^/]+\/.+)$/,
    /https?:\/\/100\.96\.203\.105:8091\/(pipeline\/[^/]+\/.+)$/,
    /https?:\/\/localhost:8091\/(pipeline\/[^/]+\/.+)$/,
  ];

  for (const pattern of storagePatterns) {
    const match = fileUrl.match(pattern);
    if (match) {
      return `/api/pipeline/documents/${match[1]}`;
    }
  }

  return fileUrl;
}

export function ProjectDocumentManager({
  projectId,
  projectName,
  currentUserId,
  readonly = false,
}: ProjectDocumentManagerProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [byApproval, setByApproval] = useState<Record<string, Document[]>>({});
  const [projectLevel, setProjectLevel] = useState<Document[]>([]);
  const [requiredDocs, setRequiredDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [togglingRequired, setTogglingRequired] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'list' | 'grouped'>('grouped');

  const [uploadData, setUploadData] = useState({
    document_type: 'supporting_doc',
    document_name: '',
    description: '',
    file_url: '',
    file_name: '',
    issue_date: '',
    expiry_date: '',
    reference_number: '',
    issuing_authority: '',
    is_required: false,
  });

  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(file: File) {
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'pipeline');
      formData.append('category', 'project-documents');
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
      setLoading(true);
      const response = await fetch(`/api/pipeline/projects/${projectId}/documents`);
      if (!response.ok) throw new Error('Failed to fetch documents');
      const data = await response.json();
      setDocuments(data.data?.documents || []);
      setByApproval(data.data?.byApproval || {});
      setProjectLevel(data.data?.projectLevel || []);
      setRequiredDocs(data.data?.requiredDocs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

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
      const response = await fetch(`/api/pipeline/projects/${projectId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...uploadData,
          uploaded_by: currentUserId || 'unknown',
        }),
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
        issue_date: '',
        expiry_date: '',
        reference_number: '',
        issuing_authority: '',
        is_required: false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(docId: string, docName: string) {
    if (!confirm(`Delete "${docName}"? This cannot be undone.`)) return;

    setDeleting(docId);
    setError(null);

    try {
      const response = await fetch(
        `/api/pipeline/projects/${projectId}/documents?docId=${docId}`,
        { method: 'DELETE' }
      );

      if (!response.ok) throw new Error('Failed to delete document');
      await fetchDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete document');
    } finally {
      setDeleting(null);
    }
  }

  async function handleToggleRequired(docId: string, currentValue: boolean) {
    setTogglingRequired(docId);
    try {
      const response = await fetch(
        `/api/pipeline/projects/${projectId}/documents?docId=${docId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_required: !currentValue }),
        }
      );
      if (!response.ok) throw new Error('Failed to update document');
      await fetchDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update document');
    } finally {
      setTogglingRequired(null);
    }
  }

  // Filter documents
  const filteredDocs = documents.filter((doc) => {
    const matchesSearch =
      !searchTerm ||
      doc.document_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.file_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.approval_type_name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'all' || doc.document_type === filterType;
    return matchesSearch && matchesType;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            Project Documents
          </h3>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            {documents.length} document{documents.length !== 1 ? 's' : ''} total
          </p>
        </div>
        {!readonly && (
          <button
            onClick={() => setShowUploadForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Upload className="w-4 h-4" />
            Add Document
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-[var(--ff-bg-secondary)] rounded-lg">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
            <input
              type="text"
              placeholder="Search documents..."
              aria-label="Search documents"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
            />
          </div>
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
        >
          <option value="all">All Types</option>
          {DOCUMENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <div className="flex border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode('grouped')}
            className={`px-3 py-2 text-sm ${viewMode === 'grouped' ? 'bg-[var(--ff-primary)] text-white' : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]'}`}
          >
            Grouped
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-2 text-sm ${viewMode === 'list' ? 'bg-[var(--ff-primary)] text-white' : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]'}`}
          >
            List
          </button>
        </div>
      </div>

      {/* Document List */}
      {filteredDocs.length === 0 ? (
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg">
          <FolderOpen className="w-12 h-12 mx-auto text-[var(--ff-text-tertiary)] mb-3" />
          <p className="text-[var(--ff-text-secondary)]">No documents found</p>
          {!readonly && (
            <button
              onClick={() => setShowUploadForm(true)}
              className="mt-3 text-blue-600 hover:underline"
            >
              Upload your first document
            </button>
          )}
        </div>
      ) : viewMode === 'grouped' ? (
        <div className="space-y-6">
          {/* Required documents */}
          {requiredDocs.filter((d) => filteredDocs.some((fd) => fd.id === d.id)).length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Required Documents ({requiredDocs.filter((d) => filteredDocs.some((fd) => fd.id === d.id)).length})
              </h4>
              <div className="space-y-2">
                {requiredDocs
                  .filter((d) => filteredDocs.some((fd) => fd.id === d.id))
                  .map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      onDelete={handleDelete}
                      onToggleRequired={handleToggleRequired}
                      deleting={deleting}
                      togglingRequired={togglingRequired}
                      readonly={readonly}
                    />
                  ))}
              </div>
            </div>
          )}

          {/* Project-level documents */}
          {projectLevel.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-[var(--ff-text-secondary)] mb-2 flex items-center gap-2">
                <FolderOpen className="w-4 h-4" />
                Project Documents ({projectLevel.length})
              </h4>
              <div className="space-y-2">
                {projectLevel
                  .filter((d) => filteredDocs.some((fd) => fd.id === d.id))
                  .map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      onDelete={handleDelete}
                      onToggleRequired={handleToggleRequired}
                      deleting={deleting}
                      togglingRequired={togglingRequired}
                      readonly={readonly}
                    />
                  ))}
              </div>
            </div>
          )}

          {/* By approval type */}
          {Object.entries(byApproval).map(([approvalName, docs]) => {
            const visibleDocs = docs.filter((d) => filteredDocs.some((fd) => fd.id === d.id));
            if (visibleDocs.length === 0) return null;
            return (
              <div key={approvalName}>
                <h4 className="text-sm font-semibold text-[var(--ff-text-secondary)] mb-2 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  {approvalName} ({visibleDocs.length})
                </h4>
                <div className="space-y-2">
                  {visibleDocs.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      onDelete={handleDelete}
                      onToggleRequired={handleToggleRequired}
                      deleting={deleting}
                      togglingRequired={togglingRequired}
                      readonly={readonly}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredDocs.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              onDelete={handleDelete}
              onToggleRequired={handleToggleRequired}
              deleting={deleting}
              togglingRequired={togglingRequired}
              readonly={readonly}
              showApproval
            />
          ))}
        </div>
      )}

      {/* Upload Form Modal */}
      {showUploadForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--ff-bg-primary)] rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-[var(--ff-border-light)] flex items-center justify-between">
              <h3 className="text-lg font-semibold">Add Document</h3>
              <button
                onClick={() => setShowUploadForm(false)}
                className="p-1 hover:bg-[var(--ff-bg-hover)] rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Document Name *</label>
                <input
                  type="text"
                  value={uploadData.document_name}
                  onChange={(e) => setUploadData({ ...uploadData, document_name: e.target.value })}
                  placeholder="e.g., Eskom Wayleave Approval"
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Document Type</label>
                  <select
                    value={uploadData.document_type}
                    onChange={(e) => setUploadData({ ...uploadData, document_type: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg"
                  >
                    {DOCUMENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Reference #</label>
                  <input
                    type="text"
                    value={uploadData.reference_number}
                    onChange={(e) => setUploadData({ ...uploadData, reference_number: e.target.value })}
                    placeholder="e.g., WL-2024-001"
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">File Name *</label>
                <input
                  type="text"
                  value={uploadData.file_name}
                  onChange={(e) => setUploadData({ ...uploadData, file_name: e.target.value })}
                  placeholder="e.g., eskom_approval.pdf"
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">File URL</label>
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
                    className="flex items-center gap-1.5 px-3 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] disabled:opacity-50 text-sm whitespace-nowrap"
                    title="Upload file"
                  >
                    {uploadingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {uploadingFile ? 'Uploading...' : 'Upload'}
                  </button>
                  <input
                    type="url"
                    value={uploadData.file_url}
                    onChange={(e) => setUploadData({ ...uploadData, file_url: e.target.value })}
                    placeholder="https://... or upload a file"
                    className="flex-1 px-3 py-2 border border-[var(--ff-border-light)] rounded-lg"
                  />
                </div>
                <p className="text-xs text-[var(--ff-text-secondary)] mt-1">Upload a file or paste a URL</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Issue Date</label>
                  <input
                    type="date"
                    value={uploadData.issue_date}
                    onChange={(e) => setUploadData({ ...uploadData, issue_date: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Expiry Date</label>
                  <input
                    type="date"
                    value={uploadData.expiry_date}
                    onChange={(e) => setUploadData({ ...uploadData, expiry_date: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Issuing Authority</label>
                <input
                  type="text"
                  value={uploadData.issuing_authority}
                  onChange={(e) => setUploadData({ ...uploadData, issuing_authority: e.target.value })}
                  placeholder="e.g., Eskom Holdings"
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg"
                />
              </div>

              {/* Required Document Toggle */}
              <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/10 border border-[var(--ff-border-light)] rounded-lg">
                <input
                  type="checkbox"
                  id="is_required"
                  checked={uploadData.is_required}
                  onChange={(e) => setUploadData({ ...uploadData, is_required: e.target.checked })}
                  className="w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                />
                <label htmlFor="is_required" className="text-sm font-medium flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-amber-500" />
                  Required Document
                </label>
                <span className="text-xs text-[var(--ff-text-secondary)] ml-auto">
                  Shows in Required Documents section
                </span>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  value={uploadData.description}
                  onChange={(e) => setUploadData({ ...uploadData, description: e.target.value })}
                  rows={2}
                  placeholder="Optional notes..."
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg"
                />
              </div>
            </div>

            <div className="p-4 border-t border-[var(--ff-border-light)] flex gap-3">
              <button
                onClick={handleUpload}
                disabled={uploading || !uploadData.document_name || !uploadData.file_name}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? 'Adding...' : 'Add Document'}
              </button>
              <button
                onClick={() => setShowUploadForm(false)}
                className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Document Row Component
function DocumentRow({
  doc,
  onDelete,
  onToggleRequired,
  deleting,
  togglingRequired,
  readonly,
  showApproval = false,
}: {
  doc: Document;
  onDelete: (id: string, name: string) => void;
  onToggleRequired?: (id: string, currentValue: boolean) => void;
  deleting: string | null;
  togglingRequired?: string | null;
  readonly: boolean;
  showApproval?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 p-3 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg hover:shadow-sm group">
      <div className="flex-shrink-0 text-2xl">{getDocTypeIcon(doc.document_type)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-[var(--ff-text-primary)] truncate">{doc.document_name}</p>
          {doc.is_required && (
            <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded flex items-center gap-0.5">
              <Shield className="w-3 h-3" /> Required
            </span>
          )}
          {doc.is_verified && <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />}
          {doc.smartsheet_attachment_id && (
            <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded">Smartsheet</span>
          )}
          {isExpired(doc.expiry_date) && (
            <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 rounded">Expired</span>
          )}
          {isExpiringSoon(doc.expiry_date) && !isExpired(doc.expiry_date) && (
            <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Expiring
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--ff-text-secondary)] mt-0.5">
          <span>{DOCUMENT_TYPES.find((t) => t.value === doc.document_type)?.label || doc.document_type}</span>
          {doc.file_size && <span>• {formatFileSize(doc.file_size)}</span>}
          {doc.reference_number && <span>• Ref: {doc.reference_number}</span>}
          {showApproval && doc.approval_type_name && (
            <span>• {doc.approval_type_name}</span>
          )}
        </div>
        {doc.expiry_date && (
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-0.5 flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Expires: {formatDate(doc.expiry_date)}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        {(doc.file_url || doc.file_path) && (
          <a
            href={getDocumentViewUrl(doc.file_url, doc.file_path) || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 hover:bg-[var(--ff-bg-hover)] rounded-lg"
            title="Open document"
          >
            <ExternalLink className="w-4 h-4 text-[var(--ff-text-secondary)]" />
          </a>
        )}
        {!readonly && onToggleRequired && (
          <button
            onClick={() => onToggleRequired(doc.id, doc.is_required)}
            disabled={togglingRequired === doc.id}
            className={`p-2 rounded-lg transition-colors ${
              doc.is_required
                ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
            }`}
            title={doc.is_required ? 'Remove from required' : 'Mark as required'}
          >
            {togglingRequired === doc.id ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Star className={`w-4 h-4 ${doc.is_required ? 'fill-current' : ''}`} />
            )}
          </button>
        )}
        {!readonly && (
          <button
            onClick={() => onDelete(doc.id, doc.document_name)}
            disabled={deleting === doc.id}
            className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-500"
            title="Delete"
          >
            {deleting === doc.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

export default ProjectDocumentManager;
