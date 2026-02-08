/**
 * Photo List Tab Component
 * Shows paginated list of photos with filters and bulk actions
 *
 * Follows FibreFlow UI patterns:
 * - CSS variables for dark mode compatibility
 * - Semi-transparent backgrounds for badges
 */

'use client';

import { useState } from 'react';
import {
  Search,
  CheckCircle,
  XCircle,
  RotateCw,
  Clock,
  Camera,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { qfieldQaApiService } from '../services/qfieldQaApiService';
import type { PhotoValidation, QAProject, QAFilters, Priority, WorkflowStatus } from '../types';

interface PhotoListTabProps {
  validations: PhotoValidation[];
  projects: QAProject[];
  filters: QAFilters;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  loading: boolean;
  selectedIds: string[];
  onFilterChange: (filters: Partial<QAFilters>) => void;
  onPageChange: (page: number) => void;
  onPhotoClick: (photo: PhotoValidation) => void;
  onSelectionChange: (ids: string[]) => void;
  onApprove: (ids: string[], notes?: string) => Promise<void>;
  onReject: (ids: string[], notes?: string) => Promise<void>;
  onEscalate: (ids: string[], reason: string) => Promise<void>;
  onRevalidate: (ids: string[]) => Promise<void>;
  onAssign: (ids: string[], assignee: string, options?: { dueDate?: string; priority?: string }) => Promise<void>;
}

export function PhotoListTab({
  validations,
  projects,
  filters,
  pagination,
  loading,
  selectedIds,
  onFilterChange,
  onPageChange,
  onPhotoClick,
  onSelectionChange,
  onApprove,
  onReject,
  onRevalidate,
}: PhotoListTabProps) {
  const [searchTerm, setSearchTerm] = useState(filters.search || '');

  // Handle select all
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      onSelectionChange(validations.map(v => v.id));
    } else {
      onSelectionChange([]);
    }
  };

  // Handle single select
  const handleSelect = (id: string, checked: boolean) => {
    if (checked) {
      onSelectionChange([...selectedIds, id]);
    } else {
      onSelectionChange(selectedIds.filter(i => i !== id));
    }
  };

  // Handle search
  const handleSearch = () => {
    onFilterChange({ search: searchTerm });
  };

  // Handle bulk actions
  const handleBulkAction = async (action: 'approve' | 'reject' | 'revalidate') => {
    if (selectedIds.length === 0) return;

    switch (action) {
      case 'approve':
        await onApprove(selectedIds);
        break;
      case 'reject':
        await onReject(selectedIds);
        break;
      case 'revalidate':
        await onRevalidate(selectedIds);
        break;
    }
  };

  const allSelected = validations.length > 0 && selectedIds.length === validations.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < validations.length;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
            <input
              type="text"
              placeholder="Search photos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full pl-10 pr-4 py-2 text-sm bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
            />
          </div>

          {/* Project Filter */}
          <select
            value={filters.projectId || ''}
            onChange={(e) => onFilterChange({ projectId: e.target.value || undefined })}
            className="px-3 py-2 text-sm bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="">All Projects</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {/* Work Type Filter */}
          <select
            value={filters.workType || ''}
            onChange={(e) => onFilterChange({ workType: e.target.value as any || undefined })}
            className="px-3 py-2 text-sm bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="">All Types</option>
            <option value="pole_installation">Pole Installation</option>
            <option value="cable_stringing">Cable Stringing</option>
            <option value="dome_joint">Dome Joint</option>
            <option value="activation">Activation</option>
          </select>

          {/* Status Filter */}
          <select
            value={filters.workflowStatus || ''}
            onChange={(e) => onFilterChange({ workflowStatus: e.target.value as WorkflowStatus || undefined })}
            className="px-3 py-2 text-sm bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="in_review">In Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="escalated">Escalated</option>
          </select>

          {/* Priority Filter */}
          <select
            value={filters.priority || ''}
            onChange={(e) => onFilterChange({ priority: e.target.value as Priority || undefined })}
            className="px-3 py-2 text-sm bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>

          {/* Clear Button */}
          <button
            onClick={() => {
              setSearchTerm('');
              onFilterChange({
                projectId: undefined,
                workType: undefined,
                workflowStatus: undefined,
                priority: undefined,
                search: undefined,
              });
            }}
            className="px-3 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="bg-blue-500/20 border border-blue-500/30 rounded-lg p-3 flex items-center justify-between">
          <span className="text-sm font-medium text-blue-400">
            {selectedIds.length} photo{selectedIds.length !== 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => handleBulkAction('approve')}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <CheckCircle className="w-4 h-4" />
              Approve
            </button>
            <button
              onClick={() => handleBulkAction('reject')}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <XCircle className="w-4 h-4" />
              Reject
            </button>
            <button
              onClick={() => handleBulkAction('revalidate')}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-[var(--ff-text-secondary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              <RotateCw className="w-4 h-4" />
              Re-validate
            </button>
            <button
              onClick={() => onSelectionChange([])}
              className="px-3 py-1.5 text-sm font-medium text-[var(--ff-text-secondary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Photo List Header */}
      <div className="flex items-center gap-2 px-1">
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected;
          }}
          onChange={(e) => handleSelectAll(e.target.checked)}
          className="w-4 h-4 rounded border-[var(--ff-border-light)] text-blue-500 focus:ring-blue-500/50"
        />
        <span className="text-sm text-[var(--ff-text-secondary)]">
          {pagination.total} photos total • Page {pagination.page} of {pagination.totalPages}
        </span>
      </div>

      {/* Photo Cards */}
      {validations.length === 0 ? (
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-8 text-center">
          <Camera className="w-12 h-12 mx-auto mb-2 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">No photos found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {validations.map((photo) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              selected={selectedIds.includes(photo.id)}
              onSelect={(checked) => handleSelect(photo.id, checked)}
              onClick={() => onPhotoClick(photo)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mt-4">
          <button
            onClick={() => onPageChange(pagination.page - 1)}
            disabled={pagination.page === 1}
            className="p-2 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--ff-bg-tertiary)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-[var(--ff-text-secondary)]" />
          </button>
          <div className="flex gap-1">
            {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
              const page = i + 1;
              return (
                <button
                  key={page}
                  onClick={() => onPageChange(page)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                    pagination.page === page
                      ? 'bg-blue-600 text-white'
                      : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)]'
                  }`}
                >
                  {page}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => onPageChange(pagination.page + 1)}
            disabled={pagination.page === pagination.totalPages}
            className="p-2 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--ff-bg-tertiary)] transition-colors"
          >
            <ChevronRight className="w-4 h-4 text-[var(--ff-text-secondary)]" />
          </button>
        </div>
      )}
    </div>
  );
}

interface PhotoCardProps {
  photo: PhotoValidation;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onClick: () => void;
}

function PhotoCard({ photo, selected, onSelect, onClick }: PhotoCardProps) {
  const photoUrl = qfieldQaApiService.getPhotoUrl(photo.photo_key);
  const filename = photo.photo_key.split('/').pop() || photo.photo_key;
  // Show pole number if available, otherwise fall back to filename
  const displayTitle = photo.feature_id && /^[A-Z]{3}\.[PS]\.[A-Z]?\d+/.test(photo.feature_id)
    ? photo.feature_id
    : filename;
  const confidence = photo.vlm_confidence !== null ? (photo.vlm_confidence * 100).toFixed(0) : null;

  return (
    <div
      className={`bg-[var(--ff-bg-secondary)] border rounded-lg overflow-hidden cursor-pointer transition-all hover:shadow-lg ${
        selected
          ? 'border-blue-500 border-2'
          : 'border-[var(--ff-border-light)]'
      }`}
    >
      <div className="relative">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => {
            e.stopPropagation();
            onSelect(e.target.checked);
          }}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 left-2 w-4 h-4 rounded border-[var(--ff-border-light)] text-blue-500 focus:ring-blue-500/50 bg-white/80 z-10"
        />
        <div
          onClick={onClick}
          className="h-40 bg-[var(--ff-bg-tertiary)] bg-cover bg-center"
          style={{ backgroundImage: `url(${photoUrl})` }}
        />
        {/* Status Badge */}
        <div className="absolute top-2 right-2">
          <StatusBadge status={photo.workflow_status} />
        </div>
        {/* Confidence Badge */}
        {confidence !== null && (
          <div className="absolute bottom-2 right-2">
            <span
              className="px-2 py-0.5 text-xs font-bold text-white rounded"
              style={{ backgroundColor: getConfidenceColor(photo.vlm_confidence || 0) }}
            >
              {confidence}%
            </span>
          </div>
        )}
      </div>
      <div className="p-3" onClick={onClick}>
        <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate" title={displayTitle}>
          {displayTitle}
        </p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="px-2 py-0.5 text-xs text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded capitalize">
            {photo.feature_type || formatWorkType(photo.work_type)}
          </span>
          {photo.priority && photo.priority !== 'normal' && (
            <PriorityBadge priority={photo.priority} />
          )}
        </div>
        {photo.assigned_to && (
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1.5">
            Assigned to: {photo.assigned_to}
          </p>
        )}
        {photo.due_date && new Date(photo.due_date) < new Date() && photo.workflow_status !== 'approved' && (
          <div className="flex items-center gap-1 mt-1.5 text-red-400">
            <Clock className="w-3 h-3" />
            <span className="text-xs">Overdue</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: WorkflowStatus }) {
  const config = {
    pending: { label: 'Pending', classes: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    in_review: { label: 'In Review', classes: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    approved: { label: 'Approved', classes: 'bg-green-500/20 text-green-400 border-green-500/30' },
    rejected: { label: 'Rejected', classes: 'bg-red-500/20 text-red-400 border-red-500/30' },
    escalated: { label: 'Escalated', classes: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  }[status] || { label: status, classes: 'bg-gray-500/20 text-gray-400 border-gray-500/30' };

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded border ${config.classes}`}>
      {config.label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const config = {
    urgent: { label: 'Urgent', classes: 'bg-red-500/20 text-red-400' },
    high: { label: 'High', classes: 'bg-orange-500/20 text-orange-400' },
    low: { label: 'Low', classes: 'bg-gray-500/20 text-gray-400' },
  }[priority];

  if (!config) return null;

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded ${config.classes}`}>
      {config.label}
    </span>
  );
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return '#22c55e';
  if (confidence >= 0.6) return '#f97316';
  return '#ef4444';
}

function formatWorkType(workType: string | null): string {
  if (!workType) return 'Unknown';
  switch (workType) {
    case 'pole_installation': return 'Pole';
    case 'cable_stringing': return 'Cable';
    case 'dome_joint': return 'Dome';
    case 'activation': return 'Activation';
    default: return workType;
  }
}

export default PhotoListTab;
