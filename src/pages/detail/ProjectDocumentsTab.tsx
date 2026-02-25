/**
 * Project Documents Tab
 * Central hub for managing all project documents:
 * - Client PO PDFs (linked from Income tab)
 * - BSS/MSS Service Schedules
 * - SOW Data Import (Poles, Drops, Fibre)
 * - BOQ Data Import
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileText,
  Upload,
  ExternalLink,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  MapPin,
  Home,
  Cable,
  FileSpreadsheet,
  Trash2,
  Download,
  Database,
} from 'lucide-react';
import { QFieldImportPanel } from '@/modules/qfield-import';
import { useSOWUpload } from '@/modules/projects/components/SOWUploadSection/hooks/useSOWUpload';
import { FILE_TYPE_CONFIGS } from '@/modules/projects/components/SOWUploadSection/types/sowUpload.types';
import { useProjectSOW } from '@/hooks/useNeonSOW';
import { ClientPOCreateModal } from '@/modules/projects/components/finance/ClientPOCreateModal';
import type { ProjectDocument, ProjectDocumentType } from '@/modules/projects/types/po-extraction.types';
import type { ClientPurchaseOrder } from '@/types/finance';
import { log } from '@/lib/logger';
import { formatDisplayDate } from '@/utils/dateFormat';

interface ProjectDocumentsTabProps {
  projectId: string;
}

interface DocumentUploadState {
  uploading: boolean;
  error: string | null;
}

export function ProjectDocumentsTab({ projectId }: ProjectDocumentsTabProps) {
  // State
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [clientPOs, setClientPOs] = useState<ClientPurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadState, setUploadState] = useState<Record<string, DocumentUploadState>>({});
  const [showCreatePO, setShowCreatePO] = useState(false);

  // File input refs
  const bssInputRef = useRef<HTMLInputElement>(null);
  const mssInputRef = useRef<HTMLInputElement>(null);

  // SOW data hooks - use summary counts for display
  const { data: sowData } = useProjectSOW(projectId);
  const polesCount = sowData?.data?.summary?.totalPoles ?? 0;
  const dropsCount = sowData?.data?.summary?.totalDrops ?? 0;
  const fibreCount = sowData?.data?.summary?.totalFibre ?? 0;

  // SOW upload hook
  const {
    files: sowFiles,
    isProcessing: sowProcessing,
    handleFileUpload: handleSOWFileUpload,
    removeFile: removeSOWFile,
    downloadTemplate: downloadSOWTemplate,
  } = useSOWUpload(projectId);

  // File input refs for SOW
  const polesInputRef = useRef<HTMLInputElement>(null);
  const dropsInputRef = useRef<HTMLInputElement>(null);
  const fibreInputRef = useRef<HTMLInputElement>(null);

  // Fetch documents and client POs
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [docsRes, posRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/documents`),
        fetch(`/api/projects/${projectId}/client-pos`),
      ]);

      if (docsRes.ok) {
        const docsData = await docsRes.json();
        setDocuments(docsData.data?.documents || []);
      }

      if (posRes.ok) {
        const posData = await posRes.json();
        setClientPOs(posData.data?.clientPOs || []);
      }
    } catch (error) {
      log.error('Failed to fetch project documents', { projectId, error });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Upload document handler
  const handleDocumentUpload = async (
    documentType: ProjectDocumentType,
    file: File
  ) => {
    setUploadState((prev) => ({
      ...prev,
      [documentType]: { uploading: true, error: null },
    }));

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('documentType', documentType);

      const response = await fetch(`/api/projects/${projectId}/documents`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      await fetchData();
      setUploadState((prev) => ({
        ...prev,
        [documentType]: { uploading: false, error: null },
      }));
    } catch (error: unknown) {
      let message = 'Upload failed';
      if (error instanceof Error) {
        message = error.message;
      } else if (typeof error === 'string') {
        message = error;
      } else if (error && typeof error === 'object' && 'error' in error) {
        message = String((error as { error: unknown }).error);
      }
      setUploadState((prev) => ({
        ...prev,
        [documentType]: { uploading: false, error: message },
      }));
    }
  };

  // Get active document of type
  const getActiveDocument = (type: ProjectDocumentType): ProjectDocument | undefined => {
    return documents.find((d) => d.documentType === type && d.isActive);
  };

  const bssDoc = getActiveDocument('bss');
  const mssDoc = getActiveDocument('mss');

  // Client POs with source documents
  const posWithDocs = clientPOs.filter((po) => po.sourceDocumentUrl);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--ff-accent)]" />
        <span className="ml-3 text-[var(--ff-text-secondary)]">Loading documents...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[var(--ff-bg-card)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[var(--ff-accent)]/20 flex items-center justify-center">
            <FileText className="w-5 h-5 text-[var(--ff-accent)]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Project Documents</h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Central hub for all project documentation - PO PDFs, service schedules, and data imports
            </p>
          </div>
        </div>
      </div>

      {/* Client PO Documents Section */}
      <section className="bg-[var(--ff-bg-card)] rounded-lg border border-[var(--ff-border-light)]">
        <div className="p-4 border-b border-[var(--ff-border-light)] flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-[var(--ff-text-primary)]">Client PO Documents</h3>
            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
              Source PDF documents uploaded with Client Purchase Orders
            </p>
          </div>
          <button
            onClick={() => setShowCreatePO(true)}
            className="px-3 py-1.5 bg-[var(--ff-accent)] hover:bg-[var(--ff-accent-hover)] text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            Add Client PO
          </button>
        </div>
        <div className="p-4">
          {clientPOs.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {clientPOs.map((po) => (
                <div
                  key={po.id}
                  className="flex items-center gap-3 p-3 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]"
                >
                  <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-green-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                      {po.sourceDocumentName || `${po.poNumber}.pdf`}
                    </p>
                    <p className="text-xs text-[var(--ff-text-secondary)]">
                      PO: {po.poNumber} | {(po.contractedDrops || 0).toLocaleString()} drops @ R{(po.pricePerDrop || 0).toLocaleString()}
                    </p>
                  </div>
                  {po.sourceDocumentUrl && (
                    <a
                      href={po.sourceDocumentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-accent)] hover:bg-[var(--ff-accent)]/10 rounded-lg transition-colors"
                      title="Open document"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <FileText className="w-12 h-12 mx-auto text-[var(--ff-text-tertiary)] mb-3" />
              <p className="text-sm text-[var(--ff-text-secondary)]">No PO documents uploaded yet</p>
              <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                Click &quot;Add Client PO&quot; to upload a PO PDF with AI extraction
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Client PO Create Modal */}
      {showCreatePO && (
        <ClientPOCreateModal
          projectId={projectId}
          onClose={() => setShowCreatePO(false)}
          onCreated={() => {
            setShowCreatePO(false);
            fetchData();
          }}
        />
      )}

      {/* Service Schedules Section (BSS/MSS) */}
      <section className="bg-[var(--ff-bg-card)] rounded-lg border border-[var(--ff-border-light)]">
        <div className="p-4 border-b border-[var(--ff-border-light)]">
          <h3 className="text-base font-semibold text-[var(--ff-text-primary)]">Service Schedules</h3>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            Build Service Schedule (BSS) and Maintenance Service Schedule (MSS) documents
          </p>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* BSS Upload */}
            <DocumentUploadCard
              label="Build Service Schedule (BSS)"
              document={bssDoc}
              documentType="bss"
              uploading={uploadState.bss?.uploading}
              error={uploadState.bss?.error}
              inputRef={bssInputRef}
              onUpload={(file) => handleDocumentUpload('bss', file)}
            />

            {/* MSS Upload */}
            <DocumentUploadCard
              label="Maintenance Service Schedule (MSS)"
              document={mssDoc}
              documentType="mss"
              uploading={uploadState.mss?.uploading}
              error={uploadState.mss?.error}
              inputRef={mssInputRef}
              onUpload={(file) => handleDocumentUpload('mss', file)}
            />
          </div>
        </div>
      </section>

      {/* SOW Data Import Section */}
      <section className="bg-[var(--ff-bg-card)] rounded-lg border border-[var(--ff-border-light)]">
        <div className="p-4 border-b border-[var(--ff-border-light)]">
          <h3 className="text-base font-semibold text-[var(--ff-text-primary)]">SOW Data Import</h3>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            Upload Excel files to import Scope of Work data (poles, drops, fibre segments)
          </p>
        </div>
        <div className="p-4">
          {/* Current data status */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-3 border border-[var(--ff-border-light)]">
              <div className="flex items-center gap-2 text-[var(--ff-text-secondary)] text-sm mb-1">
                <MapPin className="w-4 h-4" />
                Poles
              </div>
              <p className="text-xl font-semibold text-[var(--ff-text-primary)]">{polesCount.toLocaleString()}</p>
            </div>
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-3 border border-[var(--ff-border-light)]">
              <div className="flex items-center gap-2 text-[var(--ff-text-secondary)] text-sm mb-1">
                <Home className="w-4 h-4" />
                Drops
              </div>
              <p className="text-xl font-semibold text-[var(--ff-text-primary)]">{dropsCount.toLocaleString()}</p>
            </div>
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-3 border border-[var(--ff-border-light)]">
              <div className="flex items-center gap-2 text-[var(--ff-text-secondary)] text-sm mb-1">
                <Cable className="w-4 h-4" />
                Fibre Segments
              </div>
              <p className="text-xl font-semibold text-[var(--ff-text-primary)]">{fibreCount.toLocaleString()}</p>
            </div>
          </div>

          {/* Upload cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <SOWUploadCard
              type="poles"
              label="Poles Data"
              icon={MapPin}
              currentCount={polesCount}
              sowFiles={sowFiles}
              processing={sowProcessing}
              inputRef={polesInputRef}
              onUpload={(e) => handleSOWFileUpload('poles', e)}
              onRemove={() => removeSOWFile('poles')}
              onDownloadTemplate={() => downloadSOWTemplate(FILE_TYPE_CONFIGS.find(c => c.type === 'poles')!)}
            />
            <SOWUploadCard
              type="drops"
              label="Drops Data"
              icon={Home}
              currentCount={dropsCount}
              sowFiles={sowFiles}
              processing={sowProcessing}
              inputRef={dropsInputRef}
              onUpload={(e) => handleSOWFileUpload('drops', e)}
              onRemove={() => removeSOWFile('drops')}
              onDownloadTemplate={() => downloadSOWTemplate(FILE_TYPE_CONFIGS.find(c => c.type === 'drops')!)}
            />
            <SOWUploadCard
              type="fibre"
              label="Fibre Segments"
              icon={Cable}
              currentCount={fibreCount}
              sowFiles={sowFiles}
              processing={sowProcessing}
              inputRef={fibreInputRef}
              onUpload={(e) => handleSOWFileUpload('fibre', e)}
              onRemove={() => removeSOWFile('fibre')}
              onDownloadTemplate={() => downloadSOWTemplate(FILE_TYPE_CONFIGS.find(c => c.type === 'fibre')!)}
            />
          </div>
        </div>
      </section>

      {/* QField GeoPackage Import Section */}
      <section className="bg-[var(--ff-bg-card)] rounded-lg border border-[var(--ff-border-light)]">
        <div className="p-4 border-b border-[var(--ff-border-light)]">
          <h3 className="text-base font-semibold text-[var(--ff-text-primary)]">QField GeoPackage Import</h3>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            Import infrastructure data from QFieldCloud GeoPackage files (joints, cable spans, zone/PON boundaries)
          </p>
        </div>
        <div className="p-4">
          <QFieldImportPanel projectId={projectId} />
        </div>
      </section>

      {/* BOQ Data Import Section */}
      <section className="bg-[var(--ff-bg-card)] rounded-lg border border-[var(--ff-border-light)]">
        <div className="p-4 border-b border-[var(--ff-border-light)]">
          <h3 className="text-base font-semibold text-[var(--ff-text-primary)]">BOQ Data Import</h3>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            Upload Bill of Quantities Excel files
          </p>
        </div>
        <div className="p-4">
          <div className="text-center py-8 bg-[var(--ff-bg-secondary)] rounded-lg border border-dashed border-[var(--ff-border-light)]">
            <FileSpreadsheet className="w-12 h-12 mx-auto text-[var(--ff-accent)] mb-3" />
            <p className="text-sm text-[var(--ff-text-primary)] mb-3">
              Import BOQ data via the Procurement module
            </p>
            <a
              href={`/procurement/boq/new?projectId=${projectId}`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--ff-accent)] hover:bg-[var(--ff-accent-hover)] text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Upload className="w-4 h-4" />
              Import BOQ
            </a>
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-3">
              Existing BOQs can be viewed in{' '}
              <a href="/procurement/boq" className="text-[var(--ff-accent)] hover:underline">Procurement &rarr; BOQ</a>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

// Document upload card component
interface DocumentUploadCardProps {
  label: string;
  document?: ProjectDocument;
  documentType: ProjectDocumentType;
  uploading?: boolean;
  error?: string | null;
  inputRef: React.RefObject<HTMLInputElement>;
  onUpload: (file: File) => void;
}

function DocumentUploadCard({
  label,
  document,
  documentType,
  uploading,
  error,
  inputRef,
  onUpload,
}: DocumentUploadCardProps) {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="text-sm font-medium text-[var(--ff-text-primary)]">{label}</h4>
          {document && (
            <p className="text-xs text-[var(--ff-text-secondary)] mt-0.5">
              Uploaded: {formatDisplayDate(document.uploadedAt)}
            </p>
          )}
        </div>
        {document && (
          <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
        )}
      </div>

      {document ? (
        <div className="flex items-center gap-2">
          <a
            href={document.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center gap-2 px-3 py-2 bg-[var(--ff-bg-tertiary)] rounded-lg text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] transition-colors truncate"
          >
            <FileText className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{document.documentName}</span>
          </a>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="px-3 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
            title="Replace document"
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-accent)]/50 hover:bg-[var(--ff-accent)]/5 transition-colors disabled:opacity-50"
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              Upload {documentType.toUpperCase()}
            </>
          )}
        </button>
      )}

      {error && (
        <div className="mt-2 flex items-center gap-1 text-xs text-red-400">
          <XCircle className="w-3 h-3" />
          {error}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}

// SOW upload card component
interface SOWUploadCardProps {
  type: 'poles' | 'drops' | 'fibre';
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  currentCount: number;
  sowFiles: Array<{
    type: string;
    status: 'pending' | 'processing' | 'success' | 'error';
    message?: string;
    summary?: { total: number; valid: number };
  }>;
  processing: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  onDownloadTemplate: () => void;
}

function SOWUploadCard({
  type,
  label,
  icon: Icon,
  currentCount,
  sowFiles,
  processing,
  inputRef,
  onUpload,
  onRemove,
  onDownloadTemplate,
}: SOWUploadCardProps) {
  const fileState = sowFiles.find((f) => f.type === type);
  const isProcessing = fileState?.status === 'processing';
  const isSuccess = fileState?.status === 'success';
  const isError = fileState?.status === 'error';

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[var(--ff-accent)]/20 flex items-center justify-center">
            <Icon className="w-4 h-4 text-[var(--ff-accent)]" />
          </div>
          <div>
            <h4 className="text-sm font-medium text-[var(--ff-text-primary)]">{label}</h4>
            <p className="text-xs text-[var(--ff-text-secondary)]">
              {currentCount.toLocaleString()} records
            </p>
          </div>
        </div>
        {isSuccess && <CheckCircle className="w-5 h-5 text-green-400" />}
        {isError && <AlertCircle className="w-5 h-5 text-red-400" />}
      </div>

      {/* Status message */}
      {fileState?.message && (
        <div
          className={`mb-3 px-3 py-2 rounded-lg text-xs ${
            isError
              ? 'bg-red-500/10 text-red-400'
              : isSuccess
              ? 'bg-green-500/10 text-green-400'
              : 'bg-[var(--ff-accent)]/10 text-[var(--ff-accent)]'
          }`}
        >
          {fileState.message}
          {fileState.summary && (
            <span className="block mt-1">
              Imported: {fileState.summary.valid.toLocaleString()} / {fileState.summary.total.toLocaleString()}
            </span>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => inputRef.current?.click()}
          disabled={processing}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] transition-colors disabled:opacity-50"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              {currentCount > 0 ? 'Update' : 'Import'} Data
            </>
          )}
        </button>

        <button
          onClick={onDownloadTemplate}
          className="px-3 py-2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-accent)] hover:bg-[var(--ff-accent)]/10 rounded-lg transition-colors"
          title="Download template"
        >
          <Download className="w-4 h-4" />
        </button>

        {fileState && !isProcessing && (
          <button
            onClick={onRemove}
            className="px-3 py-2 text-[var(--ff-text-tertiary)] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            title="Clear upload"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
        onChange={onUpload}
        className="hidden"
      />
    </div>
  );
}

export default ProjectDocumentsTab;
