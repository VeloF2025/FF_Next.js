/**
 * Project Agreements Tab (PRD-058)
 * Displays and manages contractor agreements (SOW, MBA) for a project.
 * Supports both generating and uploading agreements, plus marking as signed.
 */

import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileText, Plus, Download, Clock, CheckCircle, AlertTriangle,
  X, Loader2, Upload, PenLine,
} from 'lucide-react';
import { log } from '@/lib/logger';
import { formatDisplayDate } from '@/utils/dateFormat';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Agreement {
  id: string;
  agreement_type: 'sow' | 'mba' | 'amendment';
  contractor_id: string;
  contractor_name: string;
  status: 'draft' | 'pending_review' | 'approved' | 'signed' | 'expired';
  effective_date: string | null;
  expiry_date: string | null;
  draft_document_url: string | null;
  signed_document_url: string | null;
  signed_at: string | null;
  created_at: string;
}

interface ContractorOption {
  id: string;
  company_name: string;
  contact_person: string | null;
  status: string;
}

interface ProjectAgreementsTabProps {
  projectId: string;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchProjectAgreements(projectId: string): Promise<Agreement[]> {
  const response = await fetch(`/api/projects/${projectId}/agreements`);
  if (!response.ok) throw new Error('Failed to fetch agreements');
  const data = await response.json();
  return data.data || [];
}

async function fetchContractors(): Promise<ContractorOption[]> {
  const response = await fetch('/api/contractors-list');
  if (!response.ok) throw new Error('Failed to fetch contractors');
  const data = await response.json();
  return data.data || [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStatusBadge(status: Agreement['status']) {
  switch (status) {
    case 'draft':
      return { bg: 'bg-secondary', text: 'text-muted-foreground', label: 'Draft' };
    case 'pending_review':
      return { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', label: 'Pending Review' };
    case 'approved':
      return { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', label: 'Approved' };
    case 'signed':
      return { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', label: 'Signed' };
    case 'expired':
      return { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: 'Expired' };
    default:
      return { bg: 'bg-secondary', text: 'text-muted-foreground', label: status };
  }
}

function getAgreementTypeLabel(type: Agreement['agreement_type']) {
  switch (type) {
    case 'sow': return 'SOW';
    case 'mba': return 'MBA';
    case 'amendment': return 'Amendment';
    default: return type;
  }
}

function formatDate(dateStr: string | null): string {
  return formatDisplayDate(dateStr, '—');
}

// ---------------------------------------------------------------------------
// New Agreement Modal — supports Generate or Upload
// ---------------------------------------------------------------------------

type ModalMode = 'generate' | 'upload';

interface NewAgreementModalProps {
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function NewAgreementModal({ projectId, onClose, onSuccess }: NewAgreementModalProps) {
  const [mode, setMode] = useState<ModalMode>('generate');
  const [agreementType, setAgreementType] = useState<'sow' | 'mba'>('mba');
  const [contractorId, setContractorId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0] ?? '');
  const [expiryDate, setExpiryDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Net 30 days from invoice date');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: contractors, isLoading: loadingContractors } = useQuery({
    queryKey: ['contractors-list'],
    queryFn: fetchContractors,
  });

  // Default expiry = 1 year from effective
  useEffect(() => {
    if (effectiveDate && !expiryDate) {
      const d = new Date(effectiveDate);
      d.setFullYear(d.getFullYear() + 1);
      setExpiryDate(d.toISOString().split('T')[0] ?? '');
    }
  }, [effectiveDate, expiryDate]);

  const handleGenerate = async () => {
    if (!contractorId) { setError('Please select a contractor'); return; }
    if (!effectiveDate || !expiryDate) { setError('Please set dates'); return; }

    setIsSubmitting(true);
    setError(null);

    try {
      // 1. Generate PDF
      const pdfRes = await fetch(`/api/projects/${projectId}/agreements/generate-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agreementType,
          contractorId,
          effectiveDate,
          expiryDate,
          totalValue: 0,
          paymentTerms,
        }),
      });

      if (!pdfRes.ok) {
        const err = await pdfRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to generate agreement');
      }

      // Download the PDF
      const blob = await pdfRes.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = pdfRes.headers.get('Content-Disposition')?.split('filename="')[1]?.replace('"', '') || 'agreement.pdf';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      // 2. Save record to DB
      await fetch(`/api/projects/${projectId}/agreements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agreement_type: agreementType,
          contractor_id: contractorId,
          effective_date: effectiveDate,
          expiry_date: expiryDate,
        }),
      });

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpload = async () => {
    if (!contractorId) { setError('Please select a contractor'); return; }
    if (!effectiveDate || !expiryDate) { setError('Please set dates'); return; }
    if (!selectedFile) { setError('Please select a PDF file'); return; }

    setIsSubmitting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('project_id', projectId);
      formData.append('contractor_id', contractorId);
      formData.append('agreement_type', agreementType);
      formData.append('effective_date', effectiveDate);
      formData.append('expiry_date', expiryDate);
      formData.append('status', 'draft');

      const res = await fetch('/api/agreements-upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to upload agreement');
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="ff-card max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            New Agreement
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* Mode: Generate or Upload */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              How would you like to add this agreement?
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMode('generate')}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  mode === 'generate'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-[var(--ff-border-light)] hover:border-[var(--ff-primary)]'
                }`}
              >
                <FileText className="w-5 h-5 mb-1 text-[var(--ff-text-primary)]" />
                <div className="font-medium text-[var(--ff-text-primary)]">Generate</div>
                <div className="text-xs text-[var(--ff-text-secondary)]">Create from template</div>
              </button>
              <button
                type="button"
                onClick={() => setMode('upload')}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  mode === 'upload'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-[var(--ff-border-light)] hover:border-[var(--ff-primary)]'
                }`}
              >
                <Upload className="w-5 h-5 mb-1 text-[var(--ff-text-primary)]" />
                <div className="font-medium text-[var(--ff-text-primary)]">Upload</div>
                <div className="text-xs text-[var(--ff-text-secondary)]">Upload existing PDF</div>
              </button>
            </div>
          </div>

          {/* Agreement Type */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              Agreement Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setAgreementType('sow')}
                className={`p-3 rounded-lg border-2 text-left transition-all ${
                  agreementType === 'sow'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-[var(--ff-border-light)] hover:border-[var(--ff-primary)]'
                }`}
              >
                <div className="font-medium text-[var(--ff-text-primary)]">SOW</div>
                <div className="text-xs text-[var(--ff-text-secondary)]">Statement of Work</div>
              </button>
              <button
                type="button"
                onClick={() => setAgreementType('mba')}
                className={`p-3 rounded-lg border-2 text-left transition-all ${
                  agreementType === 'mba'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-[var(--ff-border-light)] hover:border-[var(--ff-primary)]'
                }`}
              >
                <div className="font-medium text-[var(--ff-text-primary)]">MBA</div>
                <div className="text-xs text-[var(--ff-text-secondary)]">Master Build Agreement</div>
              </button>
            </div>
          </div>

          {/* Contractor Select */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              Contractor *
            </label>
            <select
              value={contractorId}
              onChange={(e) => setContractorId(e.target.value)}
              className="ff-input w-full"
              disabled={loadingContractors}
            >
              <option value="">Select a contractor...</option>
              {contractors?.map((c) => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                Effective Date *
              </label>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="ff-input w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                Expiry Date *
              </label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="ff-input w-full"
              />
            </div>
          </div>

          {/* Generate-only: Payment Terms */}
          {mode === 'generate' && (
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                Payment Terms
              </label>
              <input
                type="text"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                className="ff-input w-full"
              />
            </div>
          )}

          {/* Upload-only: File picker */}
          {mode === 'upload' && (
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                Agreement PDF *
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full p-4 border-2 border-dashed border-[var(--ff-border-light)] rounded-lg hover:border-[var(--ff-primary)] transition-colors text-center"
              >
                {selectedFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText className="w-5 h-5 text-green-500" />
                    <span className="text-sm text-[var(--ff-text-primary)]">{selectedFile.name}</span>
                    <span className="text-xs text-[var(--ff-text-secondary)]">
                      ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
                    </span>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-6 h-6 mx-auto text-[var(--ff-text-secondary)] mb-1" />
                    <span className="text-sm text-[var(--ff-text-secondary)]">
                      Click to select PDF file
                    </span>
                  </div>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[var(--ff-border-light)]">
          <button
            onClick={onClose}
            className="ff-button ff-button--secondary"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            onClick={mode === 'generate' ? handleGenerate : handleUpload}
            disabled={isSubmitting || !contractorId}
            className="ff-button ff-button--primary inline-flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {mode === 'generate' ? 'Generating...' : 'Uploading...'}
              </>
            ) : mode === 'generate' ? (
              <>
                <Download className="w-4 h-4" />
                Generate PDF
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Upload Agreement
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Tab Component
// ---------------------------------------------------------------------------

export function ProjectAgreementsTab({ projectId }: ProjectAgreementsTabProps) {
  const [showNewModal, setShowNewModal] = useState(false);
  const [signingId, setSigningId] = useState<string | null>(null);
  const [isMarking, setIsMarking] = useState(false);
  const queryClient = useQueryClient();

  const { data: agreements, isLoading, error } = useQuery({
    queryKey: ['project-agreements', projectId],
    queryFn: () => fetchProjectAgreements(projectId),
  });

  const handleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['project-agreements', projectId] });
  };

  const handleMarkSigned = async () => {
    if (!signingId) return;
    setIsMarking(true);
    try {
      const res = await fetch(`/api/agreements-update?id=${signingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'signed' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        log.error('MarkSigned', { error: err.error || 'Failed' });
      }
      handleSuccess();
    } catch (err) {
      log.error('MarkSigned', { error: err instanceof Error ? err.message : 'Unknown' });
    } finally {
      setIsMarking(false);
      setSigningId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="ff-card animate-pulse">
        <div className="h-8 w-48 bg-secondary rounded mb-4" />
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-secondary rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ff-card border-red-500/30">
        <div className="flex items-center gap-3 text-red-600">
          <AlertTriangle className="w-6 h-6" />
          <div>
            <p className="font-medium">Failed to load agreements</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {error instanceof Error ? error.message : 'An error occurred'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const signedAgreements = agreements?.filter(a => a.status === 'signed') || [];
  const pendingAgreements = agreements?.filter(a => ['draft', 'pending_review', 'approved'].includes(a.status)) || [];
  const expiredAgreements = agreements?.filter(a => a.status === 'expired') || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            Contractor Agreements
          </h2>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Manage SOW and Master Build Agreements for this project
          </p>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="ff-button ff-button--primary inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Agreement
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="ff-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/20">
              <CheckCircle className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{signedAgreements.length}</p>
              <p className="text-xs text-[var(--ff-text-secondary)]">Signed</p>
            </div>
          </div>
        </div>
        <div className="ff-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/20">
              <Clock className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{pendingAgreements.length}</p>
              <p className="text-xs text-[var(--ff-text-secondary)]">Pending</p>
            </div>
          </div>
        </div>
        <div className="ff-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/20">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{expiredAgreements.length}</p>
              <p className="text-xs text-[var(--ff-text-secondary)]">Expired</p>
            </div>
          </div>
        </div>
      </div>

      {/* Agreements Table */}
      <div className="ff-card">
        {!agreements || agreements.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 mx-auto text-[var(--ff-text-secondary)] mb-4" />
            <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">
              No Agreements Yet
            </h3>
            <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
              Generate or upload your first contractor agreement.
            </p>
            <button
              onClick={() => setShowNewModal(true)}
              className="ff-button ff-button--primary inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Agreement
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--ff-border-light)]">
                  <th className="ff-table-th text-left py-3 px-4">Type</th>
                  <th className="ff-table-th text-left py-3 px-4">Contractor</th>
                  <th className="ff-table-th text-left py-3 px-4">Status</th>
                  <th className="ff-table-th text-left py-3 px-4 hidden md:table-cell">Effective</th>
                  <th className="ff-table-th text-left py-3 px-4 hidden lg:table-cell">Expiry</th>
                  <th className="ff-table-th text-right py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {agreements.map((agreement) => {
                  const statusBadge = getStatusBadge(agreement.status);
                  const canSign = ['draft', 'pending_review', 'approved'].includes(agreement.status);

                  return (
                    <tr
                      key={agreement.id}
                      className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-secondary)] transition-colors"
                    >
                      <td className="py-3 px-4">
                        <span className="font-medium text-[var(--ff-text-primary)]">
                          {getAgreementTypeLabel(agreement.agreement_type)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-[var(--ff-text-primary)]">
                          {agreement.contractor_name}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusBadge.bg} ${statusBadge.text}`}>
                          {statusBadge.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        <span className="text-sm text-[var(--ff-text-secondary)]">
                          {formatDate(agreement.effective_date)}
                        </span>
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        <span className="text-sm text-[var(--ff-text-secondary)]">
                          {formatDate(agreement.expiry_date)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {canSign && (
                            <button
                              onClick={() => setSigningId(agreement.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-green-500/10 text-green-600 hover:bg-green-500/20 transition-colors"
                              title="Mark as Signed"
                            >
                              <PenLine className="w-3.5 h-3.5" />
                              Sign
                            </button>
                          )}
                          {agreement.draft_document_url && (
                            <a
                              href={agreement.draft_document_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-primary)]"
                              title="View Document"
                            >
                              <Download className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New Agreement Modal */}
      {showNewModal && (
        <NewAgreementModal
          projectId={projectId}
          onClose={() => setShowNewModal(false)}
          onSuccess={handleSuccess}
        />
      )}

      {/* Confirm Sign Dialog */}
      <ConfirmDialog
        open={!!signingId}
        onConfirm={handleMarkSigned}
        onCancel={() => setSigningId(null)}
        title="Mark Agreement as Signed"
        message="This will mark the agreement as signed and satisfy the Contractor Signed activation requirement. This action cannot be undone."
        confirmLabel={isMarking ? 'Marking...' : 'Confirm Signed'}
        variant="info"
      />
    </div>
  );
}

export default ProjectAgreementsTab;
