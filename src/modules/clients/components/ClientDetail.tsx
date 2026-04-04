'use client';

import { useState } from 'react';
import { useRouter } from 'next/router';
import { Edit, Trash2, Building, Activity, FileText } from 'lucide-react';
import { useClient, useDeleteClient } from '@/hooks/useClients';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/button';
import {
  ClientInfoSection,
  ContactDetailsSection,
  CompanyDetailsSection,
  AddressDetailsSection,
  FinancialDetailsSection,
  ProjectMetricsSection,
  ServiceTypesSection,
  NotesSection
} from './ClientDetailSections';
import { ClientProjectsTab } from './ClientProjectsTab';
import { useAuth } from '@/contexts/AuthContext';
import { Permission } from '@/types/auth.types';
import { log } from '@/lib/logger';

export function ClientDetail() {
  const router = useRouter();
  const { id } = router.query as { id: string };
  const { hasPermission } = useAuth();
  const { data: client, isLoading, error } = useClient(id || '');
  const deleteMutation = useDeleteClient();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'projects' | 'history'>('overview');

  const handleDelete = async () => {
    if (!id) return;
    
    try {
      await deleteMutation.mutateAsync(id);
      router.push('/clients');
    } catch (error) {
      log.error('Failed to delete client:', { data: error }, 'ClientDetail');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" label="Loading client..." />
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-red-500/20 border border-red-500/40 rounded-lg p-6 text-center">
          <Building className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-red-400 mb-2">Client not found</h3>
          <Button variant="link" onClick={() => router.push('/clients')}>
            Back to Client List
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] mb-6">
        <div className="p-6">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 bg-blue-500/20 rounded-full flex items-center justify-center">
                <Building className="w-8 h-8 text-blue-400" />
              </div>
              <ClientInfoSection client={client} />
            </div>

            {hasPermission(Permission.CLIENTS_UPDATE) && (
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  onClick={() => router.push(`/clients/${id}/edit`)}
                >
                  <Edit className="w-4 h-4" />
                  Edit
                </Button>

                {hasPermission(Permission.CLIENTS_DELETE) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowDeleteConfirm(true)}
                    aria-label="Delete client"
                  >
                    <Trash2 className="w-5 h-5 text-red-600" />
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="flex space-x-1 border-b border-[var(--ff-border-light)]">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 font-medium text-sm ${
                activeTab === 'overview'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('projects')}
              className={`px-4 py-2 font-medium text-sm flex items-center gap-2 ${
                activeTab === 'projects'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              <FileText className="w-4 h-4" />
              Projects ({client.totalProjects || (Number(client.activeProjects || 0) + Number(client.completedProjects || 0))})
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2 font-medium text-sm flex items-center gap-2 ${
                activeTab === 'history'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              <Activity className="w-4 h-4" />
              Contact History
            </button>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6">
            <ContactDetailsSection client={client} />
            <CompanyDetailsSection client={client} />
            <AddressDetailsSection client={client} />
            <ServiceTypesSection client={client} />
            <NotesSection client={client} />
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            <FinancialDetailsSection client={client} />
            <ProjectMetricsSection client={client} />
          </div>
        </div>
      )}

      {activeTab === 'projects' && (
        <ClientProjectsTab 
          clientId={id} 
          clientName={client.name}
          requiresPO={client.requiresPO}
        />
      )}

      {activeTab === 'history' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Contact History</h3>
            <Button variant="primary">
              Add Contact
            </Button>
          </div>
          <p className="text-[var(--ff-text-tertiary)]">Contact history feature coming soon.</p>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Delete Client?</h3>
            <p className="text-[var(--ff-text-secondary)] mb-6">
              Are you sure you want to delete "{client.name}"? This action cannot be undone and will remove all associated data.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                loading={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Client'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}