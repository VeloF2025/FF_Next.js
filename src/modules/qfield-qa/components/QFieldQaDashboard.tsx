/**
 * QField QA Dashboard
 * Hybrid layout: sidebar (project + hierarchy tree) + content (photo grid)
 *
 * Follows FibreFlow UI patterns:
 * - EnhancedStatCard + StatsGrid for summary cards
 * - CSS variables for dark mode compatibility
 * - Activate-style hierarchy navigation
 */

'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Camera,
  Layers,
  Calendar,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { StatsGrid } from '@/components/dashboard/EnhancedStatCard';
import type { EnhancedStatCardProps } from '@/components/dashboard/EnhancedStatCard';
import { useQFieldQa } from '../hooks/useQFieldQa';
import { ProjectSelector } from './ProjectSelector';
import { HierarchyTree } from './HierarchyTree';
import { SearchFilterBar } from './SearchFilterBar';
import { PhotoListTab } from './PhotoListTab';
import { PhotoDetailModal } from './PhotoDetailModal';
import type { PhotoValidation } from '../types';
import { log } from '@/lib/logger';

export function QFieldQaDashboard() {
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoValidation | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const {
    validations,
    stats,
    projects,
    hierarchy,
    hierarchyLoading,
    pagination,
    filters,
    loading,
    error,
    lastRefresh,
    selectedZone,
    selectedPon,
    selectedFeatureType,
    refresh,
    fetchHierarchy,
    selectNode,
    clearSelection,
    executeAction,
    triggerValidation,
    assignPhotos,
    updateFilters,
    clearFilters,
    setPage,
  } = useQFieldQa({ autoRefresh: true, refreshInterval: 30000 });

  // Load hierarchy when project is selected
  const handleProjectSelect = useCallback((projectId: string) => {
    updateFilters({ projectId });
    fetchHierarchy(projectId);
    clearSelection();
  }, [updateFilters, fetchHierarchy, clearSelection]);

  // Build breadcrumb from hierarchy selection
  const breadcrumb = useMemo(() => {
    const parts: string[] = [];
    if (selectedZone !== undefined) {
      parts.push(selectedZone !== null ? `Zone ${selectedZone}` : 'Unassigned');
    }
    if (selectedPon !== undefined) {
      parts.push(selectedPon !== null ? `PON ${selectedPon}` : 'Unassigned');
    }
    if (selectedFeatureType) {
      parts.push(formatWorkType(selectedFeatureType));
    }
    return parts.length > 0 ? parts.join(' > ') : undefined;
  }, [selectedZone, selectedPon, selectedFeatureType]);

  // Handle photo click
  const handlePhotoClick = (photo: PhotoValidation) => {
    setSelectedPhoto(photo);
  };

  // Handle selection change
  const handleSelectionChange = (ids: string[]) => {
    setSelectedIds(ids);
  };

  // Handle approve
  const handleApprove = async (ids: string[], notes?: string) => {
    try {
      await executeAction('approve', ids, { notes });
      setSelectedIds([]);
      setSelectedPhoto(null);
    } catch (err) {
      log.error('QFieldQaDashboard', { action: 'approve', error: err }, 'Approve failed');
    }
  };

  // Handle reject
  const handleReject = async (ids: string[], notes?: string) => {
    try {
      await executeAction('reject', ids, { notes });
      setSelectedIds([]);
      setSelectedPhoto(null);
    } catch (err) {
      log.error('QFieldQaDashboard', { action: 'reject', error: err }, 'Reject failed');
    }
  };

  // Handle escalate
  const handleEscalate = async (ids: string[], reason: string) => {
    try {
      await executeAction('escalate', ids, { escalationReason: reason });
      setSelectedIds([]);
      setSelectedPhoto(null);
    } catch (err) {
      log.error('QFieldQaDashboard', { action: 'escalate', error: err }, 'Escalate failed');
    }
  };

  // Handle re-validate
  const handleRevalidate = async (ids: string[]) => {
    try {
      const result = await triggerValidation(ids);
      setSelectedIds([]);

      if (result.mode === 'background') {
        setValidationMessage(`Queued ${result.total} photos for AI validation. Results will appear as they complete.`);
        setTimeout(() => setValidationMessage(null), 10000);
      } else if (result.success !== undefined) {
        setValidationMessage(`Validated ${result.success}/${result.total} photos`);
        setTimeout(() => setValidationMessage(null), 5000);
      }
    } catch (err) {
      log.error('QFieldQaDashboard', { action: 'revalidate', error: err }, 'Revalidate failed');
      setValidationMessage('Validation failed. Please try again.');
      setTimeout(() => setValidationMessage(null), 5000);
    }
  };

  // Handle assign
  const handleAssign = async (ids: string[], assignee: string, options?: { dueDate?: string; priority?: string }) => {
    try {
      await assignPhotos(ids, assignee, options);
      setSelectedIds([]);
    } catch (err) {
      log.error('QFieldQaDashboard', { action: 'assign', error: err }, 'Assign failed');
    }
  };

  // Build stats cards
  const statsCards: EnhancedStatCardProps[] = [
    {
      title: 'Total Photos',
      value: stats?.summary.total || 0,
      icon: Layers,
      color: '#3B82F6',
      subtitle: 'All photos',
      description: 'Total photos across all projects',
      variant: 'detailed',
      isLoading: loading,
    },
    {
      title: 'Pending',
      value: stats?.summary.pending || 0,
      icon: Clock,
      color: '#F59E0B',
      subtitle: 'Awaiting review',
      description: 'Photos pending QA review',
      variant: 'detailed',
      isLoading: loading,
    },
    {
      title: 'Approved',
      value: stats?.summary.approved || 0,
      icon: CheckCircle,
      color: '#10B981',
      subtitle: 'QA passed',
      description: 'Photos approved after review',
      variant: 'detailed',
      isLoading: loading,
    },
    {
      title: 'Rejected',
      value: stats?.summary.rejected || 0,
      icon: XCircle,
      color: '#EF4444',
      subtitle: 'QA failed',
      description: 'Photos rejected - need retake',
      variant: 'detailed',
      isLoading: loading,
    },
    {
      title: 'Escalated',
      value: stats?.summary.escalated || 0,
      icon: AlertTriangle,
      color: '#F97316',
      subtitle: 'Needs attention',
      description: 'Photos escalated for supervisor review',
      variant: 'detailed',
      isLoading: loading,
    },
    {
      title: 'Needs Retake',
      value: stats?.summary.needs_retake || 0,
      icon: Camera,
      color: '#8B5CF6',
      subtitle: 'AI flagged',
      description: 'Photos flagged by AI for retake',
      variant: 'detailed',
      isLoading: loading,
    },
  ];

  // Error state
  if (error && !validations.length) {
    return (
      <div className="space-y-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6">
          <div className="flex items-start gap-3 mb-4">
            <XCircle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-red-400 mb-1">Error Loading Dashboard</h3>
              <p className="text-sm text-red-300">{error}</p>
            </div>
          </div>
          <button
            onClick={() => refresh()}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg transition-colors"
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
          </button>
          <button
            onClick={() => refresh()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Refresh data"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
        {lastRefresh && (
          <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
            <Calendar className="h-4 w-4" />
            Last updated: {lastRefresh.toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Error Banner (non-blocking) */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Validation Status Banner */}
      {validationMessage && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 flex items-center gap-3">
          <RefreshCw className="h-5 w-5 text-blue-400 animate-spin" />
          <p className="text-sm text-blue-400">{validationMessage}</p>
          <button
            onClick={() => setValidationMessage(null)}
            className="ml-auto text-blue-400 hover:text-blue-300"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Stats Cards */}
      <StatsGrid cards={statsCards} columns={6} />

      {/* Main Layout: Sidebar + Content */}
      <div className="flex gap-4">
        {/* Sidebar */}
        {sidebarOpen && (
          <div className="w-[280px] flex-shrink-0 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden self-start sticky top-4">
            <ProjectSelector
              projects={projects}
              selectedProjectId={filters.projectId}
              onSelect={handleProjectSelect}
              loading={loading}
            />
            <HierarchyTree
              hierarchy={hierarchy}
              loading={hierarchyLoading}
              selectedZone={selectedZone}
              selectedPon={selectedPon}
              selectedFeatureType={selectedFeatureType}
              onSelectNode={selectNode}
              onClearSelection={clearSelection}
            />
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Search & Filter Bar */}
          <SearchFilterBar
            filters={filters}
            onFilterChange={updateFilters}
            onClearFilters={clearFilters}
            breadcrumb={breadcrumb}
          />

          {/* Photo Grid */}
          <PhotoListTab
            validations={validations}
            projects={projects}
            filters={filters}
            pagination={pagination}
            loading={loading}
            selectedIds={selectedIds}
            onFilterChange={updateFilters}
            onPageChange={setPage}
            onPhotoClick={handlePhotoClick}
            onSelectionChange={handleSelectionChange}
            onApprove={handleApprove}
            onReject={handleReject}
            onEscalate={handleEscalate}
            onRevalidate={handleRevalidate}
            onAssign={handleAssign}
            hideFilters
          />
        </div>
      </div>

      {/* Photo Detail Modal */}
      {selectedPhoto && (
        <PhotoDetailModal
          photo={selectedPhoto}
          open={!!selectedPhoto}
          onClose={() => setSelectedPhoto(null)}
          onApprove={(notes) => handleApprove([selectedPhoto.id], notes)}
          onReject={(notes) => handleReject([selectedPhoto.id], notes)}
          onEscalate={(reason) => handleEscalate([selectedPhoto.id], reason)}
          onRevalidate={() => handleRevalidate([selectedPhoto.id])}
        />
      )}
    </div>
  );
}

function formatWorkType(workType: string): string {
  switch (workType) {
    case 'pole_installation': return 'Poles';
    case 'cable_stringing': return 'Cables';
    case 'dome_joint': return 'Dome Joints';
    case 'activation': return 'Activation';
    default: return workType.charAt(0).toUpperCase() + workType.slice(1).replace(/_/g, ' ');
  }
}

export default QFieldQaDashboard;
