/**
 * Project Agreements Tab (PRD-058)
 * Displays and manages contractor agreements (SOW, MBA) for a project
 */

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Download, Eye, Clock, CheckCircle, AlertTriangle, X, Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';
import { formatDisplayDate } from '@/utils/dateFormat';

interface Agreement {
  id: string;
  agreement_type: 'sow' | 'mba' | 'amendment';
  contractor_id: string;
  contractor_name: string;
  reference_number: string;
  status: 'draft' | 'pending_review' | 'approved' | 'signed' | 'expired';
  effective_date: string | null;
  expiry_date: string | null;
  total_value: number;
  signed_date: string | null;
  created_at: string;
}

interface Supplier {
  id: string;
  name: string;
  company_name: string | null;
}

interface ProjectAgreementsTabProps {
  projectId: string;
}

async function fetchProjectAgreements(projectId: string): Promise<Agreement[]> {
  const response = await fetch(`/api/projects/${projectId}/agreements`);
  if (!response.ok) {
    throw new Error('Failed to fetch agreements');
  }
  const data = await response.json();
  return data.data || [];
}

async function fetchSuppliers(): Promise<Supplier[]> {
  const response = await fetch('/api/suppliers');
  if (!response.ok) {
    throw new Error('Failed to fetch suppliers');
  }
  const data = await response.json();
  return data.data || data || [];
}

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
    case 'sow': return 'Statement of Work';
    case 'mba': return 'Master Build Agreement';
    case 'amendment': return 'Amendment';
    default: return type;
  }
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(value);
}

function formatDate(dateStr: string | null): string {
  return formatDisplayDate(dateStr, '—');
}

interface GenerateModalProps {
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function GenerateAgreementModal({ projectId, onClose, onSuccess }: GenerateModalProps) {
  const [agreementType, setAgreementType] = useState<'sow' | 'mba'>('sow');
  const [contractorId, setContractorId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0]);
  const [expiryDate, setExpiryDate] = useState('');
  const [totalValue, setTotalValue] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Net 30 days from invoice date');
  const [warrantyPeriod, setWarrantyPeriod] = useState('12 months');
  const [retentionPercentage, setRetentionPercentage] = useState('5');
  const [saveToDatabase, setSaveToDatabase] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: suppliers, isLoading: loadingSuppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: fetchSuppliers,
  });

  // Set default expiry date (1 year from effective)
  useEffect(() => {
    if (effectiveDate && !expiryDate) {
      const effective = new Date(effectiveDate);
      effective.setFullYear(effective.getFullYear() + 1);
      setExpiryDate(effective.toISOString().split('T')[0]);
    }
  }, [effectiveDate, expiryDate]);

  const handleGenerate = async () => {
    if (!contractorId) {
      setError('Please select a contractor');
      return;
    }

    if (!effectiveDate || !expiryDate) {
      setError('Please set effective and expiry dates');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/agreements/generate-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agreementType,
          contractorId,
          effectiveDate,
          expiryDate,
          totalValue: totalValue ? parseFloat(totalValue) : 0,
          paymentTerms,
          warrantyPeriod: agreementType === 'sow' ? warrantyPeriod : undefined,
          retentionPercentage: retentionPercentage ? parseFloat(retentionPercentage) : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate agreement');
      }

      // Download the PDF
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = response.headers.get('Content-Disposition')?.split('filename="')[1]?.replace('"', '') || `agreement.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      // Save to database if requested
      if (saveToDatabase) {
        const saveResponse = await fetch(`/api/projects/${projectId}/agreements`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agreement_type: agreementType,
            contractor_id: contractorId,
            reference_number: `${agreementType.toUpperCase()}/${new Date().getFullYear()}/${projectId.substring(0, 8)}`,
            effective_date: effectiveDate,
            expiry_date: expiryDate,
            total_value: totalValue ? parseFloat(totalValue) : 0,
          }),
        });

        if (!saveResponse.ok) {
          // Don't throw - PDF was already downloaded
          log.warn('Failed to save agreement to database', undefined, 'ProjectAgreementsTab');
        }
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="ff-card max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            Generate Agreement
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
          {/* Agreement Type */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              Agreement Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setAgreementType('sow')}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
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
                className={`p-4 rounded-lg border-2 text-left transition-all ${
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
              disabled={loadingSuppliers}
            >
              <option value="">Select a contractor...</option>
              {suppliers?.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.company_name || supplier.name}
                </option>
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

          {/* Contract Value */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              Contract Value (ZAR)
            </label>
            <input
              type="number"
              value={totalValue}
              onChange={(e) => setTotalValue(e.target.value)}
              placeholder="0.00"
              className="ff-input w-full"
            />
          </div>

          {/* Payment Terms */}
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

          {/* SOW-specific fields */}
          {agreementType === 'sow' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                  Warranty Period
                </label>
                <input
                  type="text"
                  value={warrantyPeriod}
                  onChange={(e) => setWarrantyPeriod(e.target.value)}
                  className="ff-input w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                  Retention %
                </label>
                <input
                  type="number"
                  value={retentionPercentage}
                  onChange={(e) => setRetentionPercentage(e.target.value)}
                  className="ff-input w-full"
                />
              </div>
            </div>
          )}

          {/* Save to Database */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="saveToDb"
              checked={saveToDatabase}
              onChange={(e) => setSaveToDatabase(e.target.checked)}
              className="w-4 h-4 rounded border-[var(--ff-border-light)] text-blue-500 focus:ring-blue-500"
            />
            <label htmlFor="saveToDb" className="text-sm text-[var(--ff-text-secondary)]">
              Save agreement record to database
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[var(--ff-border-light)]">
          <button
            onClick={onClose}
            className="ff-button ff-button--secondary"
            disabled={isGenerating}
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !contractorId}
            className="ff-button ff-button--primary inline-flex items-center gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Generate PDF
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProjectAgreementsTab({ projectId }: ProjectAgreementsTabProps) {
  const [showNewModal, setShowNewModal] = useState(false);
  const queryClient = useQueryClient();

  const { data: agreements, isLoading, error } = useQuery({
    queryKey: ['project-agreements', projectId],
    queryFn: () => fetchProjectAgreements(projectId),
  });

  const handleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['project-agreements', projectId] });
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

  const activeAgreements = agreements?.filter(a => a.status === 'signed') || [];
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
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{activeAgreements.length}</p>
              <p className="text-xs text-[var(--ff-text-secondary)]">Active Agreements</p>
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
              Create your first contractor agreement for this project.
            </p>
            <button
              onClick={() => setShowNewModal(true)}
              className="ff-button ff-button--primary inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Create Agreement
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--ff-border-light)]">
                  <th className="ff-table-th text-left py-3 px-4">Reference</th>
                  <th className="ff-table-th text-left py-3 px-4">Type</th>
                  <th className="ff-table-th text-left py-3 px-4">Contractor</th>
                  <th className="ff-table-th text-left py-3 px-4">Status</th>
                  <th className="ff-table-th text-left py-3 px-4 hidden md:table-cell">Value</th>
                  <th className="ff-table-th text-left py-3 px-4 hidden lg:table-cell">Expiry</th>
                  <th className="ff-table-th text-right py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {agreements.map((agreement) => {
                  const statusBadge = getStatusBadge(agreement.status);
                  const isExpiringSoon = agreement.expiry_date &&
                    new Date(agreement.expiry_date) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

                  return (
                    <tr
                      key={agreement.id}
                      className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-secondary)] transition-colors"
                    >
                      <td className="py-3 px-4">
                        <span className="font-medium text-[var(--ff-text-primary)]">
                          {agreement.reference_number}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-[var(--ff-text-secondary)]">
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
                        <span className="text-sm text-[var(--ff-text-primary)]">
                          {formatCurrency(agreement.total_value)}
                        </span>
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        <span className={`text-sm ${isExpiringSoon ? 'text-red-500 font-medium' : 'text-[var(--ff-text-secondary)]'}`}>
                          {formatDate(agreement.expiry_date)}
                          {isExpiringSoon && ' ⚠️'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            className="p-1.5 rounded hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-primary)]"
                            title="View"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            className="p-1.5 rounded hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-primary)]"
                            title="Download"
                          >
                            <Download className="w-4 h-4" />
                          </button>
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

      {/* Generate Agreement Modal */}
      {showNewModal && (
        <GenerateAgreementModal
          projectId={projectId}
          onClose={() => setShowNewModal(false)}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}

export default ProjectAgreementsTab;
