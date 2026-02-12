/**
 * Project Document Manager Component
 * Full document management for pipeline projects - view, upload, delete
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
  Download,
  Eye,
  Filter,
  Search,
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
 * Handles various URL formats:
 * - https://vf.fibreflow.app/pipeline/{projectId}/{filename}
 * - http://100.96.203.105:8091/pipeline/{projectId}/{filename}
 * - External URLs (passed through as-is)
 */
function getDocumentViewUrl(fileUrl: string | null, filePath: string | null): string | null {
  if (!fileUrl && !filePath) return null;

  // If we have a file_path, use it directly with the proxy
  if (filePath) {
    return `/api/pipeline/documents/${filePath}`;
  }

  if (!fileUrl) return null;

  // Check if it's a known storage URL pattern
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

  // For external URLs (like example.com), return as-is
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'list' | 'grouped'>('grouped');

  // Upload form state
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
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Project Documents
          </h3>
          <p className="text-sm text-gray-500">
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
      <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search documents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
            />
          </div>
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
        >
          <option value="all">All Types</option>
          {DOCUMENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <div className="flex border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode('grouped')}
            className={`px-3 py-2 text-sm ${viewMode === 'grouped' ? 'bg-blue-100 text-blue-700' : 'bg-white dark:bg-gray-700'}`}
          >
            Grouped
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-2 text-sm ${viewMode === 'list' ? 'bg-blue-100 text-blue-700' : 'bg-white dark:bg-gray-700'}`}
          >
            List
          </button>
        </div>
      </div>

      {/* Document List */}
      {filteredDocs.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <FolderOpen className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-500">No documents found</p>
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
          {/* Project-level documents */}
          {projectLevel.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
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
                      deleting={deleting}
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
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  {approvalName} ({visibleDocs.length})
                </h4>
                <div className="space-y-2">
                  {visibleDocs.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      onDelete={handleDelete}
                      deleting={deleting}
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
              deleting={deleting}
              readonly={readonly}
              showApproval
            />
          ))}
        </div>
      )}

      {/* Upload Form Modal */}
      {showUploadForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Add Document</h3>
              <button
                onClick={() => setShowUploadForm(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
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
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Document Type</label>
                  <select
                    value={uploadData.document_type}
                    onChange={(e) => setUploadData({ ...uploadData, document_type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
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
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
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
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
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
                    className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 text-sm whitespace-nowrap"
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
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">Upload a file or paste a URL</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Issue Date</label>
                  <input
                    type="date"
                    value={uploadData.issue_date}
                    onChange={(e) => setUploadData({ ...uploadData, issue_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Expiry Date</label>
                  <input
                    type="date"
                    value={uploadData.expiry_date}
                    onChange={(e) => setUploadData({ ...uploadData, expiry_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
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
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  value={uploadData.description}
                  onChange={(e) => setUploadData({ ...uploadData, description: e.target.value })}
                  rows={2}
                  placeholder="Optional notes..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
                />
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex gap-3">
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
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
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
  deleting,
  readonly,
  showApproval = false,
}: {
  doc: Document;
  onDelete: (id: string, name: string) => void;
  deleting: string | null;
  readonly: boolean;
  showApproval?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:shadow-sm group">
      <div className="flex-shrink-0 text-2xl">{getDocTypeIcon(doc.document_type)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-gray-900 dark:text-white truncate">{doc.document_name}</p>
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
        <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
          <span>{DOCUMENT_TYPES.find((t) => t.value === doc.document_type)?.label || doc.document_type}</span>
          {doc.file_size && <span>• {formatFileSize(doc.file_size)}</span>}
          {doc.reference_number && <span>• Ref: {doc.reference_number}</span>}
          {showApproval && doc.approval_type_name && (
            <span>• {doc.approval_type_name}</span>
          )}
        </div>
        {doc.expiry_date && (
          <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Expires: {formatDate(doc.expiry_date)}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {(doc.file_url || doc.file_path) && (
          <a
            href={getDocumentViewUrl(doc.file_url, doc.file_path) || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            title="Open document"
          >
            <ExternalLink className="w-4 h-4 text-gray-500" />
          </a>
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
