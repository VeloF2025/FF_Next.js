'use client';

import { useState } from 'react';
import { useRouter } from 'next/router';
import { Edit, Trash2, Building, Activity, FileText } from 'lucide-react';
import { useClient, useDeleteClient } from '@/hooks/useClients';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
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
          <button
            onClick={() => router.push('/clients')}
            className="text-blue-400 hover:text-blue-300 font-medium"
          >
            Back to Client List
          </button>
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
                <button
                  onClick={() => router.push(`/clients/${id}/edit`)}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Edit
                </button>
                
                {hasPermission(Permission.CLIENTS_DELETE) && (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
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
            <button className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
              Add Contact
            </button>
          </div>
          <p className="text-[var(--ff-text-tertiary)]">Contact history feature coming soon.</p>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Delete Client?</h3>
            <p className="text-[var(--ff-text-secondary)] mb-6">
              Are you sure you want to delete "{client.name}"? This action cannot be undone and will remove all associated data.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)]"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Client'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}