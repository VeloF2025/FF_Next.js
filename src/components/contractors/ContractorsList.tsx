'use client';

/**
 * Contractors List - Client Component
 * Handles search, filtering, and delete operations
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Plus, Eye, Edit, Trash2, Ban } from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import type { Contractor } from '@/types/contractor.core.types';
import { CONTRACTOR_STATUSES, COMPLIANCE_STATUSES } from '@/types/contractor.core.types';
import { log } from '@/lib/logger';

interface ContractorsListProps {
  initialContractors: Contractor[];
}

export function ContractorsList({ initialContractors }: ContractorsListProps) {
  const router = useRouter();
  const [contractors, setContractors] = useState(initialContractors);
  const [searchTerm, setSearchTerm] = useState('');
  const [isProcessing, setIsProcessing] = useState<string | null>(null);

  // Filter contractors based on search
  const filteredContractors = contractors.filter((c) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      c.companyName.toLowerCase().includes(term) ||
      c.contactPerson.toLowerCase().includes(term) ||
      c.email.toLowerCase().includes(term) ||
      c.registrationNumber.toLowerCase().includes(term)
    );
  });

  const handleSuspend = async (id: string, companyName: string) => {
    if (!confirm(`Suspend contractor "${companyName}"?\n\nThey will be hidden from the active list but can be reactivated later.`)) {
      return;
    }

    setIsProcessing(id);

    try {
      const response = await fetch('/api/contractors-update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id,
          isActive: false,
          status: 'suspended'
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to suspend contractor');
      }

      // Remove from local state
      setContractors(contractors.filter((c) => c.id !== id));
      notificationService.success('Contractor suspended successfully');
      router.refresh();
    } catch (error: unknown) {
      log.error('Failed to suspend contractor', { error, contractorId: id }, 'ContractorsList');
      const message = error instanceof Error ? error.message : 'Failed to suspend contractor';
      notificationService.error(message);
    } finally {
      setIsProcessing(null);
    }
  };

  const handleDelete = async (id: string, companyName: string) => {
    if (!confirm(`PERMANENTLY DELETE contractor "${companyName}"?\n\n⚠️ This action cannot be undone!\n\nAll associated documents and onboarding data will also be deleted.`)) {
      return;
    }

    // Double confirmation for permanent delete
    if (!confirm(`Are you absolutely sure you want to delete "${companyName}"?\n\nType reasoning: This is a TEST/DEMO contractor that should be removed.`)) {
      return;
    }

    setIsProcessing(id);

    try {
      const response = await fetch('/api/contractors-delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete contractor');
      }

      // Remove from local state
      setContractors(contractors.filter((c) => c.id !== id));
      notificationService.success(data.message || 'Contractor deleted permanently');
      router.refresh();
    } catch (error: unknown) {
      log.error('Failed to delete contractor', { error, contractorId: id }, 'ContractorsList');
      const message = error instanceof Error ? error.message : 'Failed to delete contractor';
      notificationService.error(message);
    } finally {
      setIsProcessing(null);
    }
  };

  const getStatusColor = (status: string) => {
    const statusObj = CONTRACTOR_STATUSES.find((s) => s.value === status);
    return statusObj?.color || 'gray';
  };

  const getComplianceColor = (status: string) => {
    const statusObj = COMPLIANCE_STATUSES.find((s) => s.value === status);
    return statusObj?.color || 'gray';
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex-1 min-w-[200px] max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="text"
                placeholder="Search contractors..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-[var(--ff-text-tertiary)]"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-[var(--ff-text-secondary)]">
              {filteredContractors.length} of {contractors.length} contractors
            </span>
            <Link
              href="/contractors/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Add Contractor
            </Link>
          </div>
        </div>
      </div>

      {/* Contractors table */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-[var(--ff-bg-tertiary)]">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Company
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Contact
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Compliance
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ff-border-light)]">
            {filteredContractors.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-[var(--ff-text-secondary)]">
                  No contractors found
                </td>
              </tr>
            ) : (
              filteredContractors.map((contractor) => (
                <tr key={contractor.id} className="hover:bg-[var(--ff-bg-hover)] transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="font-medium text-[var(--ff-text-primary)]">
                        {contractor.companyName}
                      </div>
                      <div className="text-sm text-[var(--ff-text-secondary)]">
                        {contractor.registrationNumber}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm text-[var(--ff-text-primary)]">
                        {contractor.contactPerson}
                      </div>
                      <div className="text-sm text-[var(--ff-text-secondary)]">
                        {contractor.email}
                      </div>
                      <div className="text-sm text-[var(--ff-text-secondary)]">
                        {contractor.phone}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                        getStatusColor(contractor.status) === 'green'
                          ? 'bg-green-500/20 text-green-400'
                          : getStatusColor(contractor.status) === 'yellow'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : getStatusColor(contractor.status) === 'red'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-blue-500/20 text-blue-400'
                      }`}
                    >
                      {contractor.status.replace('_', ' ').toUpperCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                        getComplianceColor(contractor.complianceStatus) === 'green'
                          ? 'bg-green-500/20 text-green-400'
                          : getComplianceColor(contractor.complianceStatus) === 'yellow'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : getComplianceColor(contractor.complianceStatus) === 'red'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-blue-500/20 text-blue-400'
                      }`}
                    >
                      {contractor.complianceStatus.replace('_', ' ').toUpperCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/contractors/${contractor.id}`}
                        className="p-1 text-blue-400 hover:text-blue-300"
                        title="View"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                      <Link
                        href={`/contractors/${contractor.id}/edit`}
                        className="p-1 text-indigo-400 hover:text-indigo-300"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </Link>
                      <button
                        onClick={() => handleSuspend(contractor.id, contractor.companyName)}
                        disabled={isProcessing === contractor.id}
                        className="p-1 text-yellow-400 hover:text-yellow-300 disabled:opacity-50"
                        title="Suspend (hide from active list)"
                      >
                        <Ban className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(contractor.id, contractor.companyName)}
                        disabled={isProcessing === contractor.id}
                        className="p-1 text-red-400 hover:text-red-300 disabled:opacity-50"
                        title="Delete permanently"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
