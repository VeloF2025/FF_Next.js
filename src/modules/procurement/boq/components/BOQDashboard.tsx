// import React from 'react'; // Not used in this component
import Link from 'next/link';
import { Plus, Upload, FileText, Search, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProcurementErrorBoundary } from '../../components/error/ProcurementErrorBoundary';

/**
 * BOQ Dashboard - Main landing page for BOQ management
 * Following FibreFlow Universal Module Structure
 */
interface BOQDashboardProps {
  projectId: string;
  searchTerm: string;
  onEdit: (boqId: string) => void;
  onCreate: () => void;
}

export function BOQDashboard({ projectId: _projectId, searchTerm: _searchTerm, onEdit: _onEdit, onCreate: _onCreate }: BOQDashboardProps) {
  // TODO: Wire to real /api/procurement/boq endpoint
  const mockBOQs: { id: string; name: string; project: string; status: string; version: string; uploadedAt: string; items: number; mappedItems: number; exceptions: number }[] = [];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return 'bg-green-500/20 text-green-400';
      case 'MAPPING_REVIEW':
        return 'bg-yellow-500/20 text-yellow-400';
      case 'DRAFT':
        return 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]';
      default:
        return 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]';
    }
  };

  return (
    <ProcurementErrorBoundary level="page">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-[var(--ff-text-primary)]">Bill of Quantities</h1>
            <p className="text-[var(--ff-text-secondary)] mt-1">Upload, map, and manage project BOQs</p>
          </div>
          <div className="flex space-x-3">
            <Link href="/app/procurement/boq/upload"
              className="inline-flex items-center px-4 py-2 border border-[var(--ff-border-light)] rounded-md shadow-sm text-sm font-medium text-[var(--ff-text-secondary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-hover)]"
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload BOQ
            </Link>
            <Link href="/app/procurement/boq/create"
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create BOQ
            </Link>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-[var(--ff-bg-secondary)] overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <FileText className="h-6 w-6 text-blue-600" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-[var(--ff-text-secondary)] truncate">Total BOQs</dt>
                    <dd className="text-lg font-semibold text-[var(--ff-text-primary)]">12</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[var(--ff-bg-secondary)] overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <FileText className="h-6 w-6 text-green-600" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-[var(--ff-text-secondary)] truncate">Approved</dt>
                    <dd className="text-lg font-semibold text-[var(--ff-text-primary)]">8</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[var(--ff-bg-secondary)] overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <FileText className="h-6 w-6 text-yellow-600" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-[var(--ff-text-secondary)] truncate">Under Review</dt>
                    <dd className="text-lg font-semibold text-[var(--ff-text-primary)]">3</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[var(--ff-bg-secondary)] overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <FileText className="h-6 w-6 text-red-600" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-[var(--ff-text-secondary)] truncate">Exceptions</dt>
                    <dd className="text-lg font-semibold text-[var(--ff-text-primary)]">142</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Filters and Search */}
        <div className="bg-[var(--ff-bg-secondary)] shadow rounded-lg">
          <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-[var(--ff-text-primary)]">BOQ List</h3>
              <div className="flex space-x-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
                  <input
                    type="text"
                    placeholder="Search BOQs..."
                    className="pl-10 pr-4 py-2 border border-[var(--ff-border-light)] rounded-md focus:ring-blue-500 focus:border-blue-500 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
                  />
                </div>
                <Button variant="secondary" size="sm">
                  <Filter className="h-4 w-4 mr-2" />
                  Filter
                </Button>
              </div>
            </div>
          </div>

          {/* BOQ Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
              <thead className="bg-[var(--ff-bg-tertiary)]">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                    BOQ Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                    Project
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                    Items / Mapped
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                    Uploaded
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
                {mockBOQs.map((boq) => (
                  <tr key={boq.id} className="hover:bg-[var(--ff-bg-hover)]">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-[var(--ff-text-primary)]">{boq.name}</div>
                        <div className="text-sm text-[var(--ff-text-secondary)]">Version {boq.version}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--ff-text-primary)]">
                      {boq.project}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(boq.status)}`}>
                        {boq.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--ff-text-primary)]">
                      <div className="flex items-center">
                        <span>{boq.mappedItems}/{boq.items}</span>
                        {boq.exceptions > 0 && (
                          <span className="ml-2 inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-red-500/20 text-red-400">
                            {boq.exceptions} exceptions
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--ff-text-secondary)]">
                      {boq.uploadedAt}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex space-x-2">
                        <Link href={`/app/procurement/boq/${boq.id}`}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          View
                        </Link>
                        {boq.status === 'MAPPING_REVIEW' && (
                          <Link href={`/app/procurement/boq/${boq.id}/mapping`}
                            className="text-yellow-600 hover:text-yellow-900"
                          >
                            Map
                          </Link>
                        )}
                        <Link href={`/app/procurement/boq/${boq.id}/edit`}
                          className="text-green-600 hover:text-green-900"
                        >
                          Edit
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Implementation Notice */}
        <div className="bg-blue-500/20 border border-blue-500/30 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <FileText className="h-5 w-5 text-blue-400" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-blue-400">
                BOQ Management Ready
              </h3>
              <div className="mt-2 text-sm text-blue-300">
                <p>
                  BOQ structure and navigation are complete. Next phase will implement:
                  Excel upload, catalog mapping, exception handling, and approval workflows.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProcurementErrorBoundary>
  );
}
