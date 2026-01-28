/**
 * Departments Page
 * Manage departments with CRUD operations and reports
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { staffConfig } from '@/modules/navigation';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { Card, CardContent } from '@/shared/components/ui/Card';
import { StatsGrid } from '@/components/dashboard/EnhancedStatCard';
import type { EnhancedStatCardProps } from '@/components/dashboard/EnhancedStatCard';
import {
  Building2,
  Plus,
  Search,
  Users,
  UserCheck,
  UserMinus,
  X,
} from 'lucide-react';
import {
  DepartmentCard,
  DepartmentForm,
  DepartmentDetailDrawer,
} from '@/modules/staff/components/departments';
import type { Department, CreateDepartmentRequest } from '@/types/staff/department.types';

function DepartmentsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)] animate-pulse"
          >
            <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-20 mb-2"></div>
            <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-16"></div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)] animate-pulse"
          >
            <div className="h-20 bg-[var(--ff-bg-tertiary)] rounded"></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DepartmentsPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);

  const fetchDepartments = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (!showInactive) {
        params.set('isActive', 'true');
      }
      if (searchTerm) {
        params.set('search', searchTerm);
      }

      const res = await fetch(`/api/departments?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setDepartments(data.data || []);
      }
    } catch {
      // Handle error silently
    } finally {
      setLoading(false);
    }
  }, [showInactive, searchTerm]);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const handleCreate = async (data: CreateDepartmentRequest) => {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to create department');
      }

      setShowAddForm(false);
      fetchDepartments();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create department');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNavigateToStaff = (staffId: string) => {
    router.push(`/staff/${staffId}`);
  };

  // Calculate stats (counts come as strings from PostgreSQL)
  const totalDepartments = departments.length;
  const activeDepartments = departments.filter((d) => d.isActive).length;
  const totalStaff = departments.reduce((sum, d) => sum + Number(d.staffCount || 0), 0);
  const activeStaff = departments.reduce((sum, d) => sum + Number(d.activeCount || 0), 0);
  const onLeave = departments.reduce((sum, d) => sum + Number(d.onLeaveCount || 0), 0);

  // Header actions
  const headerActions = (
    <Button onClick={() => setShowAddForm(true)} className="flex items-center gap-2">
      <Plus className="h-4 w-4" />
      Add Department
    </Button>
  );

  if (loading && departments.length === 0) {
    return (
      <AppLayout>
        <ModulePage config={staffConfig} headerActions={headerActions} isLoading>
          <DepartmentsSkeleton />
        </ModulePage>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <ModulePage config={staffConfig} headerActions={headerActions}>
        <div className="space-y-6">
          {/* Stats Cards */}
          <StatsGrid
            cards={
              [
                {
                  title: 'Departments',
                  value: totalDepartments,
                  icon: Building2,
                  color: '#8B5CF6',
                  subtitle: `${activeDepartments} active`,
                  description: 'Organizational units',
                  variant: 'detailed',
                },
                {
                  title: 'Total Staff',
                  value: totalStaff,
                  icon: Users,
                  color: '#3B82F6',
                  subtitle: 'Across all departments',
                  description: 'Current headcount',
                  variant: 'detailed',
                },
                {
                  title: 'Active Staff',
                  value: activeStaff,
                  icon: UserCheck,
                  color: '#10B981',
                  subtitle: 'On duty',
                  description: 'Currently working',
                  variant: 'detailed',
                },
                {
                  title: 'On Leave',
                  value: onLeave,
                  icon: UserMinus,
                  color: '#F59E0B',
                  subtitle: 'Away',
                  description: 'Staff currently on leave',
                  variant: 'detailed',
                },
              ] as EnhancedStatCardProps[]
            }
            columns={4}
          />

          {/* Filters */}
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--ff-text-tertiary)] h-4 w-4" />
                  <Input
                    type="text"
                    placeholder="Search departments..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 w-full"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="rounded border-[var(--ff-border-light)] text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-[var(--ff-text-primary)]">
                  Show inactive
                </span>
              </label>
            </div>
          </div>

          {/* Department Grid */}
          {departments.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {departments.map((dept) => (
                <DepartmentCard
                  key={dept.id}
                  department={dept}
                  onClick={() => setSelectedDepartmentId(dept.id)}
                />
              ))}
            </div>
          ) : (
            <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
              <CardContent className="py-12 text-center">
                <Building2 className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
                <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">
                  No Departments Found
                </h3>
                <p className="text-[var(--ff-text-secondary)] mb-4">
                  {searchTerm
                    ? 'No departments match your search'
                    : 'Get started by creating your first department'}
                </p>
                {!searchTerm && (
                  <Button onClick={() => setShowAddForm(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Department
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </ModulePage>

      {/* Add Department Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowAddForm(false)} />
          <div className="relative w-full max-w-md bg-[var(--ff-bg-primary)] rounded-lg shadow-xl p-6 m-4">
            <DepartmentForm
              onSave={handleCreate}
              onCancel={() => setShowAddForm(false)}
              isSubmitting={isSubmitting}
            />
          </div>
        </div>
      )}

      {/* Department Detail Drawer */}
      {selectedDepartmentId && (
        <DepartmentDetailDrawer
          departmentId={selectedDepartmentId}
          onClose={() => setSelectedDepartmentId(null)}
          onUpdate={fetchDepartments}
          onNavigateToStaff={handleNavigateToStaff}
        />
      )}
    </AppLayout>
  );
}

// Server-side rendering to avoid router issues
export const getServerSideProps = async () => {
  return { props: {} };
};
