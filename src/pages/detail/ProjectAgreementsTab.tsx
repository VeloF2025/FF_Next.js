/**
 * Project Agreements Tab (PRD-058)
 * Displays and manages contractor agreements (SOW, MBA) for a project
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Plus, Download, Eye, Clock, CheckCircle, AlertTriangle } from 'lucide-react';

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

function getStatusBadge(status: Agreement['status']) {
  switch (status) {
    case 'draft':
      return { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-700 dark:text-gray-300', label: 'Draft' };
    case 'pending_review':
      return { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', label: 'Pending Review' };
    case 'approved':
      return { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', label: 'Approved' };
    case 'signed':
      return { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', label: 'Signed' };
    case 'expired':
      return { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: 'Expired' };
    default:
      return { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-700 dark:text-gray-300', label: status };
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
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function ProjectAgreementsTab({ projectId }: ProjectAgreementsTabProps) {
  const [showNewModal, setShowNewModal] = useState(false);

  const { data: agreements, isLoading, error } = useQuery({
    queryKey: ['project-agreements', projectId],
    queryFn: () => fetchProjectAgreements(projectId),
  });

  if (isLoading) {
    return (
      <div className="ff-card animate-pulse">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded" />
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

      {/* New Agreement Modal Placeholder */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="ff-card max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
              Create New Agreement
            </h3>
            <p className="text-sm text-[var(--ff-text-secondary)] mb-6">
              Agreement generation feature coming soon. This will allow you to generate SOW and Master Build Agreement documents.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowNewModal(false)}
                className="ff-button ff-button--secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectAgreementsTab;
