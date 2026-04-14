import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Filter } from 'lucide-react';
import { clientService } from '@/services/clientService';
import { notificationService } from '@/services/core/NotificationService';
import { ClientImport } from '@/components/clients/ClientImport';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ClientFilter } from '@/types/client.types';
import type { ClientSummary } from '@/types/client/summary.types';
import { ClientListHeader } from './ClientListHeader';
import { ClientSummaryCards } from './ClientSummaryCards';
import { ClientTable } from './ClientTable';

type ClientRow = Awaited<ReturnType<typeof clientService.getAll>>[number];

export function ClientList() {
  const [searchTerm, setSearchTerm] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [filter, setFilter] = useState<ClientFilter>({});
  const [showFilters, setShowFilters] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { data: clients, isLoading, error, refetch } = useQuery<ClientRow[]>({
    queryKey: ['clients', filter],
    queryFn: () => clientService.getAll(filter) as Promise<ClientRow[]>
  });

  const { data: summary } = useQuery<ClientSummary>({
    queryKey: ['client-summary'],
    queryFn: () => clientService.getClientSummary() as Promise<ClientSummary>
  });

  // Filter clients locally for instant search (more responsive than API-only)
  const filteredClients = clients?.filter((client) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    const companyName = (client as ClientRow & { company?: string; companyName?: string }).company
      ?? (client as ClientRow & { companyName?: string }).companyName;
    return (
      client.name?.toLowerCase().includes(search) ||
      client.email?.toLowerCase().includes(search) ||
      client.phone?.toLowerCase().includes(search) ||
      companyName?.toLowerCase().includes(search)
    );
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Also update filter for API-side search (e.g., if more data on server)
    setFilter(prev => ({ ...prev, searchTerm }));
  };

  const handleDelete = (id: string) => {
    setPendingDeleteId(id);
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    try {
      await clientService.delete(id);
      refetch();
      notificationService.success('Client deleted successfully');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to delete client';
      notificationService.error(message);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await clientService.export.exportToExcel(filteredClients as Parameters<typeof clientService.export.exportToExcel>[0]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Build descriptive filename with active filters
      const filterParts: string[] = [];
      if (filter.status?.length) filterParts.push(String(filter.status[0]));
      if (filter.searchTerm) filterParts.push('search');
      const filterSuffix = filterParts.length > 0 ? `-${filterParts.join('-')}` : '-all';
      a.download = `clients${filterSuffix}-${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notificationService.success('Client data exported');
    } catch (error) {
      notificationService.error('Failed to export client data');
    }
  };

  if (showImport) {
    return (
      <div>
        <div className="mb-4">
          <button
            onClick={() => {
              setShowImport(false);
              refetch();
            }}
            className="text-blue-600 hover:text-blue-800"
          >
            ← Back to Client List
          </button>
        </div>
        <ClientImport />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <ClientListHeader
        onImport={() => setShowImport(true)}
        onExport={handleExport}
        clientCount={filteredClients?.length || 0}
        filter={{ ...filter, searchTerm }}
      />

      {summary && <ClientSummaryCards summary={summary} />}

      {/* Search and Filters */}
      <div className="flex items-center gap-4 bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <form onSubmit={handleSearch} className="flex-1 max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--ff-text-secondary)] h-4 w-4" />
            <input
              type="text"
              placeholder="Search clients..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-[var(--ff-text-secondary)]"
            />
          </div>
        </form>

        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 px-4 py-2 text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)]"
        >
          <Filter className="h-4 w-4" />
          Filters
        </button>
      </div>

      <ClientTable
        clients={filteredClients as import('@/types/client.types').Client[] | undefined}
        isLoading={isLoading}
        error={error}
        onDelete={handleDelete}
      />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete Client"
        message="Are you sure you want to delete this client? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}