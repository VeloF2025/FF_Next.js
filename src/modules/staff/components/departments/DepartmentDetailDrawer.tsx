/**
 * Department Detail Drawer
 * Slide-out panel showing department details, staff list, and report
 */

import React, { useState, useEffect } from 'react';
import { X, Edit, Trash2, Users, ChevronRight } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { DepartmentForm } from './DepartmentForm';
import { DepartmentReport } from './DepartmentReport';
import type {
  DepartmentDetail,
  DepartmentReport as DepartmentReportType,
  CreateDepartmentRequest,
} from '@/types/staff/department.types';

interface DepartmentDetailDrawerProps {
  departmentId: string | null;
  onClose: () => void;
  onUpdate: () => void;
  onNavigateToStaff?: (staffId: string) => void;
}

type TabType = 'overview' | 'staff' | 'report';

export function DepartmentDetailDrawer({
  departmentId,
  onClose,
  onUpdate,
  onNavigateToStaff,
}: DepartmentDetailDrawerProps) {
  const [department, setDepartment] = useState<DepartmentDetail | null>(null);
  const [report, setReport] = useState<DepartmentReportType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (departmentId) {
      fetchDepartment();
    }
  }, [departmentId]);

  useEffect(() => {
    if (departmentId && activeTab === 'report' && !report) {
      fetchReport();
    }
  }, [departmentId, activeTab, report]);

  const fetchDepartment = async () => {
    if (!departmentId) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/departments/${departmentId}`);
      if (!res.ok) throw new Error('Failed to fetch department');
      const data = await res.json();
      setDepartment(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchReport = async () => {
    if (!departmentId) return;

    setIsReportLoading(true);
    setReportError(null);
    try {
      const res = await fetch(`/api/departments/${departmentId}/report`);
      if (!res.ok) throw new Error('Failed to fetch report');
      const data = await res.json();
      setReport(data.data);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setIsReportLoading(false);
    }
  };

  const handleSave = async (data: CreateDepartmentRequest) => {
    if (!departmentId) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/departments/${departmentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to update');
      }

      setIsEditing(false);
      fetchDepartment();
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!departmentId || !department) return;

    if (
      !confirm(
        `Are you sure you want to delete "${department.name}"? This action cannot be undone.`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/departments/${departmentId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to delete');
      }

      onClose();
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/20 text-green-400';
      case 'on_leave':
        return 'bg-yellow-500/20 text-yellow-400';
      case 'inactive':
        return 'bg-gray-500/20 text-gray-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  if (!departmentId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-lg bg-[var(--ff-bg-primary)] shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            {isEditing ? 'Edit Department' : 'Department Details'}
          </h2>
          <div className="flex items-center gap-2">
            {!isEditing && department && (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-2 text-[var(--ff-text-tertiary)] hover:text-blue-400 hover:bg-blue-500/10 rounded-lg"
                  title="Edit"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  onClick={handleDelete}
                  className="p-2 text-[var(--ff-text-tertiary)] hover:text-red-400 hover:bg-red-500/10 rounded-lg"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 space-y-4">
              <div className="h-24 bg-[var(--ff-bg-secondary)] rounded-lg animate-pulse" />
              <div className="h-48 bg-[var(--ff-bg-secondary)] rounded-lg animate-pulse" />
            </div>
          ) : error ? (
            <div className="p-4 text-center">
              <p className="text-red-400">{error}</p>
              <Button onClick={fetchDepartment} variant="outline" className="mt-4">
                Retry
              </Button>
            </div>
          ) : isEditing && department ? (
            <div className="p-4">
              <DepartmentForm
                department={department}
                onSave={handleSave}
                onCancel={() => setIsEditing(false)}
                isSubmitting={isSubmitting}
              />
            </div>
          ) : department ? (
            <>
              {/* Tabs */}
              <div className="flex border-b border-[var(--ff-border-light)]">
                {(['overview', 'staff', 'report'] as TabType[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                      activeTab === tab
                        ? 'text-blue-400 border-b-2 border-blue-400'
                        : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              <div className="p-4">
                {activeTab === 'overview' && (
                  <div className="space-y-4">
                    {/* Department Info */}
                    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4">
                      <h3 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-1">
                        {department.name}
                      </h3>
                      <p className="text-sm text-[var(--ff-text-tertiary)] mb-3">
                        Code: {department.code}
                      </p>
                      {department.description && (
                        <p className="text-sm text-[var(--ff-text-secondary)]">
                          {department.description}
                        </p>
                      )}
                      {department.managerName && (
                        <p className="text-sm text-[var(--ff-text-secondary)] mt-2">
                          Manager: <span className="text-[var(--ff-text-primary)]">{department.managerName}</span>
                        </p>
                      )}
                    </div>

                    {/* Quick Stats */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                          {department.staffCount}
                        </p>
                        <p className="text-xs text-[var(--ff-text-tertiary)]">
                          Total Staff
                        </p>
                      </div>
                      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold text-green-400">
                          {department.activeCount}
                        </p>
                        <p className="text-xs text-[var(--ff-text-tertiary)]">Active</p>
                      </div>
                      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold text-yellow-400">
                          {department.onLeaveCount}
                        </p>
                        <p className="text-xs text-[var(--ff-text-tertiary)]">
                          On Leave
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'staff' && (
                  <div className="space-y-2">
                    {department.staff && department.staff.length > 0 ? (
                      department.staff.map((member) => (
                        <div
                          key={member.id}
                          onClick={() => onNavigateToStaff?.(member.id)}
                          className="flex items-center justify-between p-3 bg-[var(--ff-bg-secondary)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                              <span className="text-sm font-medium text-blue-400">
                                {member.name?.charAt(0) || '?'}
                              </span>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                                {member.name}
                              </p>
                              <p className="text-xs text-[var(--ff-text-tertiary)]">
                                {member.position || 'No position'}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              className={getStatusColor(member.status)}
                              variant="secondary"
                            >
                              {member.status.replace('_', ' ')}
                            </Badge>
                            <ChevronRight className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8">
                        <Users className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
                        <p className="text-[var(--ff-text-secondary)]">
                          No staff in this department
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'report' && (
                  isReportLoading ? (
                    <DepartmentReport report={{} as DepartmentReportType} isLoading={true} />
                  ) : report ? (
                    <DepartmentReport report={report} isLoading={false} />
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-red-400 mb-2">{reportError || 'Failed to load report'}</p>
                      <Button onClick={fetchReport} variant="outline">
                        Retry
                      </Button>
                    </div>
                  )
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
