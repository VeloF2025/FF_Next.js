/**
 * BOQ History Component - Refactored Version
 * Main container for version control, change tracking, and audit trail
 */

import { useMemo } from 'react';
import { History, GitBranch, Loader2, RefreshCw } from 'lucide-react';
import { BOQHistoryProps } from './history/BOQHistoryTypes';
import { useBOQHistory } from './history/useBOQHistory';
import BOQHistoryFilters from './history/BOQHistoryFilters';
import BOQVersionCard from './history/BOQVersionCard';
import BOQVersionComparison from './history/BOQVersionComparison';

export default function BOQHistory({
  boqId,
  onVersionSelect,
  onRestore,
  className
}: BOQHistoryProps) {
  const {
    versions,
    filteredVersions,
    selectedVersions,
    comparison,
    expandedVersions,
    filters,
    setFilters,
    isLoading,
    isComparing,
    showComparison,
    setShowComparison,
    loadVersionHistory,
    toggleVersionExpansion,
    selectVersionForComparison,
    compareVersions,
    restoreVersion,
    exportVersion
  } = useBOQHistory(boqId, onVersionSelect, onRestore);

  // Get unique users for filter
  const uniqueUsers = useMemo(() => {
    return [...new Set(versions.map(v => v.createdBy))];
  }, [versions]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-muted-foreground">Loading version history...</span>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <History className="h-6 w-6 text-blue-500 mr-2" />
          <h2 className="text-xl font-semibold text-foreground">Version History</h2>
          <span className="ml-3 px-2 py-1 bg-secondary text-muted-foreground rounded-full text-sm">
            {versions.length} versions
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {selectedVersions[0] && selectedVersions[1] && (
            <button
              onClick={compareVersions}
              disabled={isComparing}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center"
            >
              {isComparing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <GitBranch className="h-4 w-4 mr-2" />
              )}
              Compare Selected
            </button>
          )}

          <button
            onClick={loadVersionHistory}
            className="p-2 text-muted-foreground hover:text-muted-foreground"
            title="Refresh history"
          >
            <RefreshCw className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <BOQHistoryFilters
        filters={filters}
        setFilters={setFilters}
        uniqueUsers={uniqueUsers}
      />

      {/* Version List */}
      {filteredVersions.length > 0 ? (
        <div className="space-y-3">
          {filteredVersions.map(version => (
            <BOQVersionCard
              key={version.id}
              version={version}
              isExpanded={expandedVersions.has(version.id)}
              isSelected={
                selectedVersions[0]?.id === version.id ||
                selectedVersions[1]?.id === version.id
              }
              onToggleExpand={() => toggleVersionExpansion(version.id)}
              onSelect={() => selectVersionForComparison(version)}
              onView={() => onVersionSelect?.(version)}
              onRestore={() => restoreVersion(version)}
              onExport={() => exportVersion(version)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-card rounded-lg border">
          <History className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-foreground">No Version History</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {versions.length === 0
              ? "This BOQ doesn't have any version history yet."
              : "No versions match your current filters."}
          </p>
        </div>
      )}

      {/* Version Comparison Modal */}
      {showComparison && comparison && (
        <BOQVersionComparison
          comparison={comparison}
          onClose={() => setShowComparison(false)}
        />
      )}
    </div>
  );
}