/**
 * Client PO Detail Modal
 * Shows detailed view of a Client Purchase Order with actions
 * Includes Documents section for BSS/MSS uploads
 */

import { useState, useEffect, useCallback } from 'react';
import type { ClientPurchaseOrder, ClientPOProgress } from '@/types/finance';
import type { ProjectDocument, ProjectDocumentType } from '@/modules/projects/types/po-extraction.types';
import { DOCUMENT_TYPE_LABELS } from '@/modules/projects/types/po-extraction.types';
import { log } from '@/lib/logger';

interface ClientPODetailModalProps {
  projectId: string;
  clientPO: ClientPurchaseOrder;
  onClose: () => void;
  onUpdated: () => void;
}

export function ClientPODetailModal({ projectId, clientPO, onClose, onUpdated }: ClientPODetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ClientPOProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDetails() {
      try {
        // Fetch PO details
        const response = await fetch(`/api/projects/${projectId}/client-pos/${clientPO.id}`);
        if (!response.ok) throw new Error('Failed to fetch details');
        const data = await response.json();
        setProgress(data.progress);

        // Fetch linked documents
        const docsResponse = await fetch(`/api/projects/${projectId}/documents?clientPoId=${clientPO.id}`);
        if (docsResponse.ok) {
          const docsData = await docsResponse.json();
          setDocuments(docsData.documents || []);
        }
      } catch (err) {
        log.error('Failed to fetch Client PO details', { clientPoId: clientPO.id, err });
      }
    }
    fetchDetails();
  }, [projectId, clientPO.id]);

  const handleActivate = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/client-pos/${clientPO.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to activate');
      }
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate');
    } finally {
      setLoading(false);
    }
  };

  const handleDocumentUpload = useCallback(async (file: File, documentType: ProjectDocumentType) => {
    setUploading(documentType);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('documentType', documentType);
      formData.append('clientPoId', clientPO.id);

      const response = await fetch(`/api/projects/${projectId}/documents`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to upload document');
      }

      const result = await response.json();

      // Add to documents list
      setDocuments(prev => [result.document, ...prev]);

      log.info('Document uploaded', {
        projectId,
        clientPoId: clientPO.id,
        documentType,
        documentId: result.document.id,
      });
    } catch (err) {
      log.error('Failed to upload document', { projectId, clientPoId: clientPO.id, documentType, err });
      setError(err instanceof Error ? err.message : 'Failed to upload document');
    } finally {
      setUploading(null);
    }
  }, [projectId, clientPO.id]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>, documentType: ProjectDocumentType) => {
    const file = e.target.files?.[0];
    if (file) {
      handleDocumentUpload(file, documentType);
    }
    // Reset the input
    e.target.value = '';
  }, [handleDocumentUpload]);

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatFileSize = (bytes: number | undefined) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const statusColors: Record<string, { bg: string; text: string }> = {
    draft: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
    active: { bg: 'bg-green-500/20', text: 'text-green-400' },
    completed: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
    cancelled: { bg: 'bg-red-500/20', text: 'text-red-400' },
  };

  const colors = statusColors[clientPO.status] ?? { bg: 'bg-gray-500/20', text: 'text-gray-400' };

  // Get BSS and MSS documents
  const bssDoc = documents.find(d => d.documentType === 'bss');
  const mssDoc = documents.find(d => d.documentType === 'mss');
  const otherDocs = documents.filter(d => d.documentType !== 'bss' && d.documentType !== 'mss');

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--ff-card-bg)] rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[var(--ff-card-bg)] px-6 py-4 border-b border-[var(--ff-border-light)] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">{clientPO.poNumber}</h2>
            {clientPO.reference && (
              <p className="text-sm text-[var(--ff-text-secondary)]">{clientPO.reference}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors.bg} ${colors.text} capitalize`}>
              {clientPO.status}
            </span>
            <button
              onClick={onClose}
              className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Source Document Badge */}
          {clientPO.sourceDocumentUrl && (
            <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm text-blue-400">Created from PDF</span>
                </div>
                <a
                  href={clientPO.sourceDocumentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:underline"
                >
                  View Source PDF →
                </a>
              </div>
              {clientPO.vlmConfidenceScore && (
                <div className="text-xs text-[var(--ff-text-secondary)] mt-1">
                  Extraction confidence: {Math.round(clientPO.vlmConfidenceScore * 100)}%
                </div>
              )}
            </div>
          )}

          {/* Contract Details */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4">
              <div className="text-sm text-[var(--ff-text-secondary)]">Contracted Drops</div>
              <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {clientPO.contractedDrops.toLocaleString()}
              </div>
            </div>
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4">
              <div className="text-sm text-[var(--ff-text-secondary)]">Price per Drop</div>
              <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                R {clientPO.pricePerDrop.toLocaleString()}
              </div>
            </div>
            <div className="bg-blue-500/10 rounded-lg p-4">
              <div className="text-sm text-[var(--ff-text-secondary)]">Total Contract Value</div>
              <div className="text-2xl font-bold text-blue-400">
                R {clientPO.totalValue.toLocaleString()}
              </div>
            </div>
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4">
              <div className="text-sm text-[var(--ff-text-secondary)]">Tax Rate</div>
              <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {clientPO.taxRate}%
              </div>
            </div>
          </div>

          {/* Progress */}
          {progress && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-[var(--ff-text-secondary)]">Progress</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--ff-text-secondary)]">Drops Activated</span>
                    <span className="text-[var(--ff-text-primary)]">{progress.activatedPercent}%</span>
                  </div>
                  <div className="h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500"
                      style={{ width: `${Math.min(progress.activatedPercent, 100)}%` }}
                    />
                  </div>
                  <div className="text-xs text-[var(--ff-text-secondary)] mt-1">
                    {clientPO.dropsActivated} / {clientPO.contractedDrops}
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--ff-text-secondary)]">Amount Invoiced</span>
                    <span className="text-[var(--ff-text-primary)]">{progress.invoicedPercent}%</span>
                  </div>
                  <div className="h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500"
                      style={{ width: `${Math.min(progress.invoicedPercent, 100)}%` }}
                    />
                  </div>
                  <div className="text-xs text-[var(--ff-text-secondary)] mt-1">
                    R {clientPO.amountInvoiced.toLocaleString()} / R {clientPO.totalValue.toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="flex justify-between p-3 bg-[var(--ff-bg-secondary)] rounded-lg">
                <span className="text-sm text-[var(--ff-text-secondary)]">Remaining to Invoice</span>
                <span className="text-sm font-medium text-amber-400">
                  R {progress.remainingValue.toLocaleString()}
                </span>
              </div>
            </div>
          )}

          {/* Documents Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-[var(--ff-text-secondary)]">Documents</h3>

            {/* BSS and MSS slots */}
            <div className="grid grid-cols-2 gap-4">
              {/* BSS */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-[var(--ff-text-primary)]">BSS</span>
                  {bssDoc && (
                    <span className="text-xs text-green-400">✓ Uploaded</span>
                  )}
                </div>
                <p className="text-xs text-[var(--ff-text-secondary)] mb-3">Build Service Schedule</p>

                {bssDoc ? (
                  <div className="flex items-center justify-between">
                    <a
                      href={bssDoc.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-400 hover:underline truncate flex-1"
                    >
                      {bssDoc.documentName}
                    </a>
                    <span className="text-xs text-[var(--ff-text-secondary)] ml-2">
                      {formatFileSize(bssDoc.fileSize)}
                    </span>
                  </div>
                ) : (
                  <label className="block">
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={(e) => handleFileInput(e, 'bss')}
                      className="hidden"
                      disabled={uploading === 'bss'}
                    />
                    <span className={`w-full px-3 py-2 text-sm text-center rounded-lg border border-dashed border-[var(--ff-border-light)] cursor-pointer hover:border-blue-500 hover:bg-blue-500/5 transition-colors flex items-center justify-center gap-2 ${
                      uploading === 'bss' ? 'opacity-50 cursor-not-allowed' : ''
                    }`}>
                      {uploading === 'bss' ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Uploading...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          Upload BSS
                        </>
                      )}
                    </span>
                  </label>
                )}
              </div>

              {/* MSS */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-[var(--ff-text-primary)]">MSS</span>
                  {mssDoc && (
                    <span className="text-xs text-green-400">✓ Uploaded</span>
                  )}
                </div>
                <p className="text-xs text-[var(--ff-text-secondary)] mb-3">Maintenance Service Schedule</p>

                {mssDoc ? (
                  <div className="flex items-center justify-between">
                    <a
                      href={mssDoc.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-400 hover:underline truncate flex-1"
                    >
                      {mssDoc.documentName}
                    </a>
                    <span className="text-xs text-[var(--ff-text-secondary)] ml-2">
                      {formatFileSize(mssDoc.fileSize)}
                    </span>
                  </div>
                ) : (
                  <label className="block">
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={(e) => handleFileInput(e, 'mss')}
                      className="hidden"
                      disabled={uploading === 'mss'}
                    />
                    <span className={`w-full px-3 py-2 text-sm text-center rounded-lg border border-dashed border-[var(--ff-border-light)] cursor-pointer hover:border-blue-500 hover:bg-blue-500/5 transition-colors flex items-center justify-center gap-2 ${
                      uploading === 'mss' ? 'opacity-50 cursor-not-allowed' : ''
                    }`}>
                      {uploading === 'mss' ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Uploading...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          Upload MSS
                        </>
                      )}
                    </span>
                  </label>
                )}
              </div>
            </div>

            {/* Other Documents */}
            {otherDocs.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-[var(--ff-text-secondary)]">Other Documents</h4>
                {otherDocs.map(doc => (
                  <div key={doc.id} className="flex items-center justify-between p-2 bg-[var(--ff-bg-secondary)] rounded-lg">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <svg className="w-4 h-4 text-[var(--ff-text-secondary)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <a
                        href={doc.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-400 hover:underline truncate"
                      >
                        {doc.documentName}
                      </a>
                    </div>
                    <span className="text-xs text-[var(--ff-text-secondary)] ml-2">
                      {DOCUMENT_TYPE_LABELS[doc.documentType]}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-[var(--ff-text-secondary)]">PO Date</div>
              <div className="text-[var(--ff-text-primary)]">{formatDate(clientPO.poDate)}</div>
            </div>
            <div>
              <div className="text-[var(--ff-text-secondary)]">Valid From</div>
              <div className="text-[var(--ff-text-primary)]">{formatDate(clientPO.validFrom)}</div>
            </div>
            <div>
              <div className="text-[var(--ff-text-secondary)]">Valid To</div>
              <div className="text-[var(--ff-text-primary)]">{formatDate(clientPO.validTo)}</div>
            </div>
          </div>

          {clientPO.description && (
            <div>
              <div className="text-sm text-[var(--ff-text-secondary)] mb-1">Description</div>
              <div className="text-sm text-[var(--ff-text-primary)] p-3 bg-[var(--ff-bg-secondary)] rounded-lg">
                {clientPO.description}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--ff-border-light)]">
            {clientPO.status === 'draft' && (
              <button
                onClick={handleActivate}
                disabled={loading}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white rounded-lg font-medium transition-colors"
              >
                {loading ? 'Activating...' : 'Activate PO'}
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
