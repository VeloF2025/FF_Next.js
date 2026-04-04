'use client';

/**
 * Staff List Component - Refactored Version
 * Main container for staff management with split components
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/router';
import { useQuery } from '@tanstack/react-query';
import { staffService } from '@/services/staffService';
import { StaffImport } from '@/components/staff/StaffImport';
import { StaffListHeader } from './StaffListHeader';
import { StaffFilters } from './StaffFilters';
import { StaffTable } from './StaffTable';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StaffFilter, StaffMember, StaffSummary } from '@/types/staff.types';
import { log } from '@/lib/logger';
import { formatLabel } from '@/lib/utils';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export function StaffList() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [filter, setFilter] = useState<StaffFilter>({});
  const [showFilters, setShowFilters] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { data: staff = [], isLoading, error, refetch } = useQuery({
    queryKey: ['staff', filter],
    queryFn: async () => {
      const result = await staffService.getAll(filter);
      return result as StaffMember[];
    }
  });

  const { data: summary } = useQuery({
    queryKey: ['staff-summary'],
    queryFn: async () => {
      const result = await staffService.getStaffSummary();
      return result as StaffSummary;
    }
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
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
      await staffService.delete(id);
      await refetch();
    } catch (error) {
      log.error('Failed to delete staff member:', { data: error }, 'StaffList');
    }
  };

  const handleExport = async () => {
    try {
      const csvContent = staff.map(member => ({
        'Employee ID': member.employeeId,
        'Name': member.name,
        'Email': member.email,
        'Phone': member.phone,
        'Position': member.position || '',
        'Department': formatLabel(member.department, ''),
        'Status': member.status || '',
        'Start Date': member.startDate || '',
        'Project Count': member.currentProjectCount || 0
      }));

      if (csvContent.length === 0) {
        throw new Error('No staff data to export');
      }

      const firstRow = csvContent[0];
      if (!firstRow) {
        throw new Error('Invalid staff data');
      }

      const csv = [
        Object.keys(firstRow).join(','),
        ...csvContent.map(row => Object.values(row).join(','))
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Build descriptive filename with active filters
      const filterParts: string[] = [];
      if (filter.status) filterParts.push(filter.status);
      if (filter.department) filterParts.push(filter.department.replace(/\s+/g, '-'));
      if (filter.position) filterParts.push(filter.position.replace(/\s+/g, '-'));
      if (filter.searchTerm) filterParts.push('search');
      const filterSuffix = filterParts.length > 0 ? `-${filterParts.join('-')}` : '-all';
      a.download = `staff${filterSuffix}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      log.error('Export failed:', { data: error }, 'StaffList');
    }
  };

  if (showImport) {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Import Staff</h1>
          <Button
            variant="secondary"
            onClick={() => setShowImport(false)}
          >
            Back to List
          </Button>
        </div>
        <StaffImport onComplete={async () => {
          setShowImport(false);
          await refetch();
        }} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Failed to load staff data</p>
        <Button
          variant="primary"
          onClick={() => refetch()}
          className="mt-2"
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StaffListHeader
        totalStaff={summary?.totalStaff || 0}
        activeStaff={summary?.activeStaff || 0}
        utilizationRate={Math.round(summary?.utilizationRate || 0)}
        showFilters={showFilters}
        setShowFilters={setShowFilters}
        onAddStaff={() => router.push('/staff/new')}
        onImport={() => setShowImport(true)}
        onSettings={() => router.push('/staff/settings')}
        onExport={handleExport}
        filter={filter}
      />

      {showFilters && (
        <StaffFilters
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          filter={filter}
          setFilter={setFilter}
          onSearch={handleSearch}
        />
      )}

      <StaffTable
        staff={staff}
        onView={(staff: StaffMember) => router.push(`/staff/${staff.id}`)}
        onEdit={(staff: StaffMember) => router.push(`/staff/${staff.id}/edit`)}
        onDelete={handleDelete}
      />

      {staff.length === 0 && (
        <div className="text-center py-12">
          <p className="text-[var(--ff-text-secondary)] text-lg">No staff members found</p>
          <Button
            variant="primary"
            onClick={() => router.push('/staff/new')}
            className="mt-4"
          >
            Add First Staff Member
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete Staff Member"
        message="Are you sure you want to delete this staff member? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}