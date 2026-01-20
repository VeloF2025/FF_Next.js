/**
 * QA Centre Page Component
 * Lists DRs for quality assurance review
 * Contains search, filters, DR list, and pagination
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, RefreshCw, Calendar, Download, Filter, X, ArrowLeft } from 'lucide-react';
import { SystemHealthDashboard } from './SystemHealthDashboard';
import {
  ActivateDataProvider,
  useActivateData,
  getTodaySAST,
  getYesterdaySAST,
  type QaStatusFilter,
  type SerialStatusFilter,
} from '../context';
import type {
  QaWizardPhase,
  QaDecision,
  SerialValidationStatus,
} from '../services/activateDataService';

// ============================================================================
// BADGE COLOR REFERENCE
// ============================================================================

const BADGE_COLORS = {
  // Status badges
  installed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
  activated: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200',
  pending: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  inReview: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200',
  pass: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
  fail: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200',
  rework: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200',

  // Serial validation borders
  valid: 'border-green-500',
  swapped: 'border-yellow-500',
  missing: 'border-red-500',
  invalid: 'border-orange-500',
} as const;

// ============================================================================
// STATUS BADGE STACK COMPONENT
// ============================================================================

interface StatusBadgeProps {
  isActivated: boolean;
  qaPhase: QaWizardPhase | null;
  qaDecision: QaDecision | null;
  feedbackSent: string | null;
}

/**
 * Shows the most relevant status badge based on priority:
 * 1. QA Decision (PASS/FAIL/REWORK)
 * 2. In Review (final_decision or feedback phase)
 * 3. Activated (in OES but not QA'd)
 * 4. Installed (default - submitted via WA)
 */
function StatusBadge({ isActivated, qaPhase, qaDecision, feedbackSent }: StatusBadgeProps) {
  // Priority 1: QA Decision exists
  if (qaDecision === 'PASS') {
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${BADGE_COLORS.pass}`}>
        QA Passed ✓
      </span>
    );
  }
  if (qaDecision === 'FAIL') {
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${BADGE_COLORS.fail}`}>
        QA Failed ✗
      </span>
    );
  }
  if (qaDecision === 'REWORK_NEEDED') {
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${BADGE_COLORS.rework}`}>
        Rework Needed
      </span>
    );
  }

  // Priority 2: In Review (final_decision or feedback phase)
  if (qaPhase === 'final_decision' || qaPhase === 'feedback') {
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${BADGE_COLORS.inReview}`}>
        In Review
      </span>
    );
  }

  // Priority 3: Activated (in OES but not yet QA'd)
  if (isActivated && !qaDecision) {
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${BADGE_COLORS.activated}`}>
        Activated
      </span>
    );
  }

  // Priority 4: Pending QA (has a phase but not reviewed yet)
  if (qaPhase && ['prerequisites', 'photo_review', 'data_validation'].includes(qaPhase)) {
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${BADGE_COLORS.pending}`}>
        Pending QA
      </span>
    );
  }

  // Default: Installed (submitted via WA, not in OES yet)
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${BADGE_COLORS.installed}`}>
      Installed
    </span>
  );
}

// ============================================================================
// SERIAL VALIDATION BADGE COMPONENT
// ============================================================================

interface SerialDisplayProps {
  label: 'ONT' | 'UPS';
  serial: string | null;
  status: SerialValidationStatus;
  showMissingAlert?: boolean;
}

/**
 * Shows full serial with validation indicator and missing alert badge
 */
function SerialDisplay({ label, serial, status, showMissingAlert = true }: SerialDisplayProps) {
  const isOnt = label === 'ONT';

  // Status indicator
  const getStatusIcon = () => {
    switch (status) {
      case 'valid': return <span className="text-green-500">✓</span>;
      case 'swapped': return <span className="text-yellow-500">⚠</span>;
      case 'invalid': return <span className="text-orange-500">⚠</span>;
      case 'missing': return <span className="text-red-500">✗</span>;
    }
  };

  const labelColor = isOnt
    ? 'text-blue-600 dark:text-blue-400'
    : 'text-purple-600 dark:text-purple-400';

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={`font-semibold ${labelColor}`}>{label}:</span>
      {serial ? (
        <>
          <span className="font-mono text-gray-700 dark:text-gray-300">{serial}</span>
          {getStatusIcon()}
        </>
      ) : (
        <>
          <span className="text-gray-400 dark:text-gray-500 italic">-</span>
          {showMissingAlert && (
            <span className="text-[10px] font-semibold bg-yellow-800 text-yellow-200 px-1 py-0.5 rounded">
              {label}?
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// PROJECT BADGE COMPONENT
// ============================================================================

const PROJECT_COLORS: Record<string, string> = {
  'Lawley': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  'Mohadin': 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  'Mamelodi': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  'Velo Test': 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
  'default': 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300',
};

function ProjectBadge({ project }: { project: string | null }) {
  const projectName = project || 'Unknown';
  const colorClass = PROJECT_COLORS[projectName] || PROJECT_COLORS['default'];

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold ${colorClass}`}>
      {projectName}
    </span>
  );
}

// ============================================================================
// STATUS TIMELINE COMPONENT
// ============================================================================

interface StatusTimelineProps {
  createdAt: string;
  isActivated: boolean;
  oesActivationDate: string | null;
  qaPhase: QaWizardPhase | null;
  qaDecision: QaDecision | null;
  feedbackSent: string | null;
  senderPhone: string | null; // If present, DR was submitted via WhatsApp
  hasMaintenanceTicket?: boolean; // Whether DR has been referred to maintenance
}

/**
 * Inline status badges for compact card layout
 * Shows all status badges in a single line that wraps on mobile:
 * [Installed date] [Activated date] [QA status] [✓ Sent]
 *
 * For OES-only DRs (no WA submission): Shows [OES Only] + [Activated date]
 * For WA-submitted DRs: Shows [Installed date] + [Activated date]
 */
function InlineStatusBadges({ createdAt, isActivated, oesActivationDate, qaPhase, qaDecision, feedbackSent, senderPhone, hasMaintenanceTicket }: StatusTimelineProps) {
  // Format date - shorter format for inline display
  const formatShortDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  // Check if this is a WA-submitted DR (has sender phone)
  const hasWaSubmission = !!senderPhone;

  return (
    <>
      {/* Installed date - only shown for WA-submitted DRs */}
      {hasWaSubmission ? (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-900/40 text-blue-300">
          {formatShortDate(createdAt)}
        </span>
      ) : (
        /* OES-only indicator - shown when no WA submission */
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-700/50 text-gray-400">
          OES Only
        </span>
      )}

      {/* Activated date - shown when OES activated */}
      {isActivated && oesActivationDate && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-900/40 text-green-300">
          ✓ Act {formatShortDate(oesActivationDate)}
        </span>
      )}

      {/* QA decision - shown prominently if exists */}
      {qaDecision && (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
          qaDecision === 'PASS' ? 'bg-green-600 text-white' :
          qaDecision === 'FAIL' ? 'bg-red-600 text-white' :
          'bg-orange-600 text-white'
        }`}>
          {qaDecision === 'PASS' ? '✓ PASS' : qaDecision === 'FAIL' ? '✗ FAIL' : '↺ REWORK'}
        </span>
      )}

      {/* Maintenance ticket - shown if DR has been referred */}
      {hasMaintenanceTicket && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-700 text-white">
          🎫 Maint
        </span>
      )}

      {/* Pending QA - shown when no decision yet */}
      {!qaDecision && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-600 text-white">
          Pending
        </span>
      )}

      {/* Feedback Sent */}
      {feedbackSent && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-900/40 text-purple-300">
          ✓ Sent
        </span>
      )}
    </>
  );
}

// ============================================================================
// WRAPPER COMPONENT (Provides Context)
// ============================================================================

export function QaCentrePage() {
  return (
    <ActivateDataProvider refreshInterval={30000} autoRefreshEnabled={true}>
      <QaCentrePageContent />
    </ActivateDataProvider>
  );
}

// ============================================================================
// MAIN CONTENT (Consumes Context)
// ============================================================================

function QaCentrePageContent() {
  const router = useRouter();

  // Get shared data from context
  const {
    filteredDrops,
    pagination,
    filters,
    updateFilter,
    setFilters,
    clearFilters,
    currentPage,
    goToNextPage,
    goToPreviousPage,
    isLoading,
    error,
    refresh,
    lastRefreshAt,
    projects,
    drops,
  } = useActivateData();

  // Local UI state
  const [searchInput, setSearchInput] = useState('');
  const [showFilters, setShowFilters] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      updateFilter('searchTerm', searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, updateFilter]);

  // Quick filter handler
  const handleQuickFilter = useCallback((filter: 'today' | 'yesterday' | 'last7days' | 'all') => {
    const todayStr = getTodaySAST();

    switch (filter) {
      case 'today':
        setFilters(prev => ({ ...prev, dateFrom: todayStr, dateTo: todayStr }));
        break;
      case 'yesterday': {
        const yesterdayStr = getYesterdaySAST();
        setFilters(prev => ({ ...prev, dateFrom: yesterdayStr, dateTo: yesterdayStr }));
        break;
      }
      case 'last7days': {
        const last7DaysDate = new Date(todayStr);
        last7DaysDate.setDate(last7DaysDate.getDate() - 7);
        const last7DaysStr = last7DaysDate.toISOString().split('T')[0] as string;
        setFilters(prev => ({ ...prev, dateFrom: last7DaysStr, dateTo: todayStr }));
        break;
      }
      case 'all':
        setFilters(prev => ({ ...prev, dateFrom: '', dateTo: '' }));
        break;
    }
  }, [setFilters]);

  // Get active quick filter
  const getActiveQuickFilter = (): 'today' | 'yesterday' | 'last7days' | 'all' => {
    if (!filters.dateFrom && !filters.dateTo) return 'all';

    const todayStr = getTodaySAST();
    const yesterdayStr = getYesterdaySAST();
    const last7DaysDate = new Date(todayStr);
    last7DaysDate.setDate(last7DaysDate.getDate() - 7);
    const last7DaysStr = last7DaysDate.toISOString().split('T')[0] as string;

    if (filters.dateFrom === todayStr && filters.dateTo === todayStr) return 'today';
    if (filters.dateFrom === yesterdayStr && filters.dateTo === yesterdayStr) return 'yesterday';
    if (filters.dateFrom === last7DaysStr && filters.dateTo === todayStr) return 'last7days';

    return 'all';
  };

  // Handle DR selection - navigate to QA Centre detail page
  const handleSelectDr = (dropNumber: string) => {
    router.push(`/activate/qa-centre/${dropNumber}`);
  };

  // Handle clear filters
  const handleClearFilters = () => {
    setSearchInput('');
    clearFilters();
  };

  // Export to CSV using API endpoint for full data with all fields
  const handleExportExcel = useCallback(async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      if (filters.projectFilter !== 'all') params.set('project', filters.projectFilter);
      if (filters.statusFilter !== 'all') params.set('status', filters.statusFilter);

      const url = `/api/activate/export?${params.toString()}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error('Export failed');
      }

      // Get the CSV content and trigger download
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `qa-centre-export-${filters.dateFrom || 'all'}-to-${filters.dateTo || 'all'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to export data. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [filters]);

  // Format phone number for display
  const formatAgent = (phone: string | null) => {
    if (!phone) return 'Unknown';
    return phone.replace(/^27/, '0');
  };

  // Skeleton component
  const Skeleton = ({ className }: { className?: string }) => (
    <div className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded ${className || ''}`} />
  );

  const hasActiveFilters = filters.searchTerm || filters.dateFrom || filters.dateTo ||
    filters.statusFilter !== 'all' || filters.qaStatusFilter !== 'all' || filters.serialStatusFilter !== 'all' || filters.projectFilter !== 'all' || filters.resubmissionsOnly;

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
            <h3 className="text-red-800 dark:text-red-200 font-semibold mb-2">Error Loading DRs</h3>
            <p className="text-red-600 dark:text-red-400">{error}</p>
            <button
              onClick={refresh}
              className="mt-4 px-4 py-2 bg-red-600 dark:bg-red-500 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-600 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/activate')}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              title="Back to Dashboard"
            >
              <ArrowLeft className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                QA Centre
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                Review and validate DR photos
              </p>
            </div>
          </div>
          <button
            onClick={refresh}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            title="Refresh data"
          >
            <RefreshCw className={`h-4 w-4 text-gray-600 dark:text-gray-400 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="text-sm text-gray-700 dark:text-gray-300">REFRESH</span>
          </button>
        </div>

        {/* System Health Status */}
        <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">System Status:</span>
              <SystemHealthDashboard compact autoRefresh refreshInterval={60} />
            </div>
            {lastRefreshAt && (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Calendar className="h-4 w-4" />
                Last updated: {lastRefreshAt.toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>

        {/* Quick Filter Buttons */}
        <div className="mb-4 flex gap-2">
          {(['today', 'yesterday', 'last7days', 'all'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => handleQuickFilter(filter)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                getActiveQuickFilter() === filter
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {filter === 'today' ? 'Today' : filter === 'yesterday' ? 'Yesterday' : filter === 'last7days' ? 'Last 7 days' : 'All'}
            </button>
          ))}
        </div>

        {/* Search and Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-6 mb-6">
          <div className="flex flex-col gap-4">
            {/* Search Bar Row */}
            <div className="flex items-center gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 h-5 w-5" />
                <input
                  type="text"
                  placeholder="Search drop number..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                />
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`px-4 py-3 rounded-lg transition-colors flex items-center gap-2 ${
                  showFilters || hasActiveFilters
                    ? 'bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                <Filter className="h-5 w-5" />
                Filters
                {hasActiveFilters && (
                  <span className="ml-1 px-2 py-0.5 bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 rounded-full text-xs font-semibold">
                    Active
                  </span>
                )}
              </button>

              {/* Export Button */}
              <button
                onClick={handleExportExcel}
                disabled={isExporting}
                className="px-4 py-3 rounded-lg font-medium transition-colors bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                title="Export filtered data to Excel"
              >
                <Download className={`h-5 w-5 ${isExporting ? 'animate-bounce' : ''}`} />
                {isExporting ? 'Exporting...' : 'Export Excel'}
              </button>
            </div>

            {/* Filter Options */}
            {showFilters && (
              <div className="grid grid-cols-1 md:grid-cols-6 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                {/* From Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    From Date
                  </label>
                  <input
                    type="date"
                    value={filters.dateFrom}
                    onChange={(e) => updateFilter('dateFrom', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>

                {/* To Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    To Date
                  </label>
                  <input
                    type="date"
                    value={filters.dateTo}
                    onChange={(e) => updateFilter('dateTo', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Install Status Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Install Status
                  </label>
                  <select
                    value={filters.statusFilter}
                    onChange={(e) => updateFilter('statusFilter', e.target.value as 'all' | 'installed' | 'activated' | 'not_reviewed' | 'reviewed')}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="all">All</option>
                    <option value="installed">Installed Only</option>
                    <option value="activated">Activated Only</option>
                  </select>
                </div>

                {/* QA Status Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    QA Status
                  </label>
                  <select
                    value={filters.qaStatusFilter}
                    onChange={(e) => updateFilter('qaStatusFilter', e.target.value as QaStatusFilter)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                    <option value="rework">Rework</option>
                  </select>
                </div>

                {/* Serial Status Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Serial Status
                  </label>
                  <select
                    value={filters.serialStatusFilter}
                    onChange={(e) => updateFilter('serialStatusFilter', e.target.value as SerialStatusFilter)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="all">All</option>
                    <option value="valid">✓ Confirmed</option>
                    <option value="swapped">⚠ Swapped</option>
                    <option value="missing">✗ Missing</option>
                    <option value="invalid">⚠ Invalid</option>
                  </select>
                </div>

                {/* Project Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Project
                  </label>
                  <select
                    value={filters.projectFilter}
                    onChange={(e) => updateFilter('projectFilter', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="all">All Projects</option>
                    {projects
                      .filter(project => !['Test', 'Marketing', 'Velo Test', 'test', 'marketing', 'Integration Test', 'Test Project'].includes(project))
                      .map(project => (
                        <option key={project} value={project}>{project}</option>
                      ))}
                  </select>
                </div>

                {/* Resubmissions Only Checkbox */}
                <div className="md:col-span-6 flex items-center gap-4 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.resubmissionsOnly}
                      onChange={(e) => updateFilter('resubmissionsOnly', e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1">
                      <span className="text-base">🔄</span>
                      Show Resubmissions Only
                    </span>
                  </label>
                </div>

                {/* Clear Filters Button */}
                {hasActiveFilters && (
                  <div className="md:col-span-6 flex justify-end">
                    <button
                      onClick={handleClearFilters}
                      className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors flex items-center gap-2"
                    >
                      <X className="h-4 w-4" />
                      Clear All Filters
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* DR List */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 overflow-hidden">
          {/* Summary Header */}
          <div className="bg-gray-50 dark:bg-gray-900/50 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Showing {filteredDrops.length} of {pagination.totalCount > 0 ? pagination.totalCount : drops.length} drops
                {pagination.totalPages > 1 && (
                  <span className="ml-2 text-sm font-normal text-gray-600 dark:text-gray-400">
                    (Page {currentPage} of {pagination.totalPages})
                  </span>
                )}
              </h2>
            </div>
          </div>

          {/* List Content */}
          {isLoading ? (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={`dr-skeleton-${i}`} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Skeleton className="h-6 w-32" />
                      </div>
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-4 w-36" />
                      </div>
                    </div>
                    <Skeleton className="h-7 w-20 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredDrops.length === 0 ? (
            <div className="p-12 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 mb-4">
                <Search className="h-8 w-8 text-gray-400 dark:text-gray-500" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No DRs Found</h3>
              <p className="text-gray-600 dark:text-gray-400">
                {hasActiveFilters
                  ? 'Try adjusting your filters to see more results.'
                  : 'DRs will appear here once they are received from WhatsApp Monitor.'}
              </p>
            </div>
          ) : (
            <div className="p-4">
              {/* Table Header */}
              <div className="grid grid-cols-[70px_95px_65px_65px_1fr_160px] gap-2 px-3 py-2 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-300 dark:border-gray-600 mb-2">
                <span>Project</span>
                <span>DR</span>
                <span>Installed</span>
                <span>Activated</span>
                <span className="text-center">QA Status / Outcome</span>
                <span className="text-right">ONT / UPS Issues</span>
              </div>

              {/* Table Rows */}
              <div className="grid gap-1">
                {filteredDrops.map((drop) => {
                  // Format dates
                  const formatDate = (dateStr: string | null) => {
                    if (!dateStr) return '-';
                    const date = new Date(dateStr);
                    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                  };

                  // Format time (HH:MM)
                  const formatTime = (dateStr: string | null) => {
                    if (!dateStr) return '';
                    const date = new Date(dateStr);
                    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                  };

                  // Get QA Review Status (Pending vs Reviewed)
                  const getQaReviewStatus = () => {
                    if (drop.feedbackSent) return { label: 'Reviewed', color: 'bg-green-700 text-green-100' };
                    if (drop.qaDecision) return { label: 'Reviewed', color: 'bg-green-700 text-green-100' };
                    return { label: 'Pending', color: 'bg-gray-600 text-gray-200' };
                  };

                  // Get Outcome badge
                  const getOutcomeBadge = () => {
                    if (drop.qaDecision === 'PASS') return { label: 'Pass', color: 'bg-green-600 text-white' };
                    if (drop.qaDecision === 'FAIL') return { label: 'Fail', color: 'bg-red-600 text-white' };
                    if (drop.qaDecision === 'REWORK_NEEDED') return { label: 'Rework', color: 'bg-orange-600 text-white' };
                    if (drop.hasMaintenanceTicket) return { label: 'Maint', color: 'bg-amber-700 text-white' };
                    return { label: '-', color: 'text-gray-500' };
                  };

                  // Get serial issue indicator
                  const getSerialIssue = (status: SerialValidationStatus, isSwapped: boolean) => {
                    if (isSwapped) return { label: 'Swap', color: 'bg-red-700 text-red-100' };
                    if (status === 'missing') return { label: 'Missing', color: 'bg-yellow-700 text-yellow-100' };
                    if (status === 'invalid') return { label: 'Invalid', color: 'bg-orange-700 text-orange-100' };
                    if (status === 'valid') return null; // Don't show badge for valid
                    return null;
                  };

                  const qaStatus = getQaReviewStatus();
                  const outcome = getOutcomeBadge();
                  const ontIssue = getSerialIssue(drop.ontSerialStatus, drop.serialsSwapped);
                  const upsIssue = getSerialIssue(drop.upsSerialStatus, false);

                  return (
                    <button
                      key={drop.id}
                      onClick={() => handleSelectDr(drop.dropNumber)}
                      className="w-full text-left bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 hover:bg-gray-100 dark:hover:bg-gray-900/70 transition-all hover:shadow-md border border-gray-200 dark:border-gray-700"
                    >
                      {/* Row 1: Project | DR | Installed | Activated | [CENTER: QA Status | Outcome] | [RIGHT: Issues] */}
                      <div className="grid grid-cols-[70px_95px_65px_65px_1fr_160px] gap-2 items-center text-xs mb-1">
                        {/* Project */}
                        <span className="truncate">
                          <ProjectBadge project={drop.project} />
                        </span>

                        {/* DR Number with Resubmission Badge */}
                        <span className="font-bold text-sm text-gray-900 dark:text-white truncate flex items-center gap-1">
                          {drop.dropNumber}
                          {drop.isResubmission && (
                            <span className="text-base" title={`Submission #${drop.submissionCount} (was ${drop.previousPhotoCount || 0} photos)`}>
                              🔄
                            </span>
                          )}
                        </span>

                        {/* Installed Date */}
                        <span className="text-blue-400 font-medium">
                          {formatDate(drop.submittedDate || drop.createdAt)}
                        </span>

                        {/* Activated Date */}
                        <span className="text-green-400 font-medium">
                          {drop.isActivated && drop.oesActivationDate ? formatDate(drop.oesActivationDate) : '-'}
                        </span>

                        {/* CENTER: QA Status | Outcome */}
                        <div className="flex items-center justify-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${qaStatus.color}`}>
                            {qaStatus.label}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${outcome.color}`}>
                            {outcome.label}
                          </span>
                        </div>

                        {/* RIGHT: ONT / UPS Issues */}
                        <div className="flex items-center justify-end gap-2 text-[10px]">
                          {ontIssue && (
                            <span className={`px-1.5 py-0.5 rounded font-bold ${ontIssue.color}`}>
                              ONT: {ontIssue.label}
                            </span>
                          )}
                          {upsIssue && (
                            <span className={`px-1.5 py-0.5 rounded font-bold ${upsIssue.color}`}>
                              UPS: {upsIssue.label}
                            </span>
                          )}
                          {!ontIssue && !upsIssue && (
                            <span className="text-green-400">✓</span>
                          )}
                        </div>
                      </div>

                      {/* Row 2: Tech ID | Photos | WA Time | [empty] | [empty] | [RIGHT: ONT serial | UPS serial] */}
                      <div className="grid grid-cols-[70px_95px_65px_65px_1fr_160px] gap-2 text-[10px] text-gray-500 dark:text-gray-400 items-center">
                        <span className="font-medium text-gray-600 dark:text-gray-300 truncate">
                          {formatAgent(drop.senderPhone)}
                        </span>
                        <span className="font-medium text-gray-600 dark:text-gray-300">
                          📷 {drop.photoCount || 0}
                        </span>
                        {/* WA Submission Time (below Installed date) */}
                        <span className="text-blue-400/70 text-[9px]">
                          {formatTime(drop.waReceivedAt)}
                        </span>
                        {/* OES Import Time (below Activated date) */}
                        <span className="text-green-400/70 text-[9px]">
                          {formatTime(drop.oesImportedAt)}
                        </span>
                        <span></span>
                        {/* RIGHT: Serials */}
                        <div className="flex items-center justify-end gap-4 font-mono text-[10px]">
                          <span className="flex items-center gap-1">
                            <span className="text-blue-400 font-semibold">ONT:</span>
                            <span className="text-gray-400">{drop.ontSerial || '-'}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="text-purple-400 font-semibold">UPS:</span>
                            <span className="text-gray-400">{drop.upsSerial || '-'}</span>
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Pagination Controls */}
          {pagination.totalPages > 1 && !isLoading && (
            <div className="bg-gray-50 dark:bg-gray-900/50 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Page {currentPage} of {pagination.totalPages} • Showing {filteredDrops.length} drops per page
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={goToPreviousPage}
                    disabled={!pagination.hasPreviousPage}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      pagination.hasPreviousPage
                        ? 'bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    ← Previous
                  </button>
                  <button
                    onClick={goToNextPage}
                    disabled={!pagination.hasNextPage}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      pagination.hasNextPage
                        ? 'bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    Next →
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
