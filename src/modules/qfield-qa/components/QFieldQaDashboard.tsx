/**
 * QField QA Dashboard
 * Main dashboard for QField photo validation and QA workflow
 *
 * Follows FibreFlow UI patterns:
 * - EnhancedStatCard + StatsGrid for summary cards
 * - CSS variables for dark mode compatibility
 * - Tab navigation via URL params
 */

'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  User,
  Camera,
  Layers,
  Calendar,
} from 'lucide-react';
import { StatsGrid } from '@/components/dashboard/EnhancedStatCard';
import type { EnhancedStatCardProps } from '@/components/dashboard/EnhancedStatCard';
import { useQFieldQa } from '../hooks/useQFieldQa';
import { OverviewTab } from './OverviewTab';
import { PhotoListTab } from './PhotoListTab';
import { PhotoDetailModal } from './PhotoDetailModal';
import type { PhotoValidation } from '../types';
import { log } from '@/lib/logger';

type TabType = 'overview' | 'queue' | 'photos';

export function QFieldQaDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read tab from URL, default to 'overview'
  const tabFromUrl = (searchParams.get('tab') as TabType) || 'overview';
  const [activeTab, setActiveTab] = useState<TabType>(tabFromUrl);

  const [selectedPhoto, setSelectedPhoto] = useState<PhotoValidation | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState<string>('');

  const {
    validations,
    stats,
    projects,
    pagination,
    filters,
    loading,
    error,
    lastRefresh,
    refresh,
    executeAction,
    triggerValidation,
    assignPhotos,
    updateFilters,
    clearFilters,
    setPage,
  } = useQFieldQa({ autoRefresh: true, refreshInterval: 30000 });

  // Get current user from auth context or session
  useEffect(() => {
    setCurrentUser(localStorage.getItem('userEmail') || '');
  }, []);

  // Sync tab with URL
  useEffect(() => {
    if (tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  // My queue count
  const myQueueCount = useMemo(() => {
    if (!currentUser || !validations) return 0;
    return validations.filter(v => v.assigned_to === currentUser).length;
  }, [currentUser, validations]);

  // Handle tab change - update URL
  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.push(`?${params.toString()}`, { scroll: false });

    // Update filters based on tab
    if (tab === 'queue') {
      updateFilters({ assignedTo: currentUser, workflowStatus: 'in_review' });
    } else if (tab === 'photos') {
      clearFilters();
    } else {
      clearFilters();
    }
  }, [router, searchParams, currentUser, updateFilters, clearFilters]);

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
      await triggerValidation(ids);
      setSelectedIds([]);
    } catch (err) {
      log.error('QFieldQaDashboard', { action: 'revalidate', error: err }, 'Revalidate failed');
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
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

      {/* Stats Cards */}
      <StatsGrid cards={statsCards} columns={6} />

      {/* Tabs */}
      <div className="border-b border-[var(--ff-border-light)]">
        <nav className="flex gap-6" aria-label="Tabs">
          <button
            onClick={() => handleTabChange('overview')}
            className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'overview'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-medium)]'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => handleTabChange('queue')}
            className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'queue'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-medium)]'
            }`}
          >
            My Queue
            {myQueueCount > 0 && (
              <span className="px-2 py-0.5 text-xs font-medium bg-blue-500/20 text-blue-400 rounded-full">
                {myQueueCount}
              </span>
            )}
          </button>
          <button
            onClick={() => handleTabChange('photos')}
            className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'photos'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-medium)]'
            }`}
          >
            All Photos
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <OverviewTab
          stats={stats}
          recentActivity={stats?.recent_activity || []}
          onViewAll={() => handleTabChange('photos')}
        />
      )}

      {activeTab === 'queue' && (
        <PhotoListTab
          validations={validations.filter(v => v.assigned_to === currentUser)}
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
        />
      )}

      {activeTab === 'photos' && (
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
        />
      )}

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

export default QFieldQaDashboard;
