/**
 * BOQ List Header Component
 */

import { Plus, Filter, RefreshCw, Upload, LayoutGrid, List } from 'lucide-react';

export type ViewMode = 'cards' | 'list';

interface BOQListHeaderProps {
  totalBOQs: number;
  filteredCount: number;
  showFilters: boolean;
  setShowFilters: (show: boolean) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  onCreateBOQ?: (() => void) | undefined;
  onUploadBOQ?: (() => void) | undefined;
  onRefresh: () => void;
}

export default function BOQListHeader({
  totalBOQs,
  filteredCount,
  showFilters,
  setShowFilters,
  viewMode,
  setViewMode,
  onCreateBOQ,
  onUploadBOQ,
  onRefresh
}: BOQListHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">Bill of Quantities</h2>
        <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
          {filteredCount === totalBOQs
            ? `${totalBOQs} BOQs`
            : `${filteredCount} of ${totalBOQs} BOQs`
          }
        </p>
      </div>

      <div className="flex items-center space-x-2">
        {/* View Toggle */}
        <div className="flex border border-[var(--ff-border-light)] rounded-md overflow-hidden">
          <button
            onClick={() => setViewMode('cards')}
            className={`p-2 ${
              viewMode === 'cards'
                ? 'bg-blue-500/20 text-blue-400'
                : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
            }`}
            title="Card view"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 border-l border-[var(--ff-border-light)] ${
              viewMode === 'list'
                ? 'bg-blue-500/20 text-blue-400'
                : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
            }`}
            title="List view"
          >
            <List className="h-4 w-4" />
          </button>
        </div>

        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`px-3 py-2 border rounded-md text-sm font-medium flex items-center ${
            showFilters
              ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
              : 'border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
          }`}
        >
          <Filter className="h-4 w-4 mr-2" />
          Filters
        </button>

        <button
          onClick={onRefresh}
          className="px-3 py-2 border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] rounded-md text-sm font-medium hover:bg-[var(--ff-bg-hover)] flex items-center"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </button>

        {onUploadBOQ && (
          <button
            onClick={onUploadBOQ}
            className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 flex items-center"
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload BOQ
          </button>
        )}

        {onCreateBOQ && (
          <button
            onClick={onCreateBOQ}
            className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 flex items-center"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create BOQ
          </button>
        )}
      </div>
    </div>
  );
}