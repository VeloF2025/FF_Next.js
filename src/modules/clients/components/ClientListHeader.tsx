'use client';

import { useRouter } from 'next/router';
import { Plus, Upload, Download } from 'lucide-react';
import { PermissionGate } from '@/components/PermissionGate';

interface ClientListHeaderProps {
  onImport: () => void;
  onExport: () => void;
  clientCount: number;
}

export function ClientListHeader({ onImport, onExport, clientCount }: ClientListHeaderProps) {
  const router = useRouter();

  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--ff-text-primary)]">Client Management</h1>
        <p className="text-[var(--ff-text-secondary)] mt-1">Manage your client relationships and information</p>
      </div>
      <div className="flex gap-3">
        <PermissionGate permission="clients.list" action="create">
          <button
            onClick={onImport}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)]"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import
          </button>
        </PermissionGate>
        <button
          onClick={onExport}
          disabled={clientCount === 0}
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="h-4 w-4 mr-2" />
          Export
        </button>
        <PermissionGate permission="clients.list" action="create">
          <button
            onClick={() => router.push('/app/clients/new')}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Client
          </button>
        </PermissionGate>
      </div>
    </div>
  );
}