/**
 * BOQ Viewer Header Component
 */

import { Filter, Download, Edit3, Eye, RefreshCw } from 'lucide-react';
import { BOQWithItems } from '@/types/procurement/boq.types';
import { getStatusBadge } from './BOQViewerUtils';

interface BOQViewerHeaderProps {
  boqData: BOQWithItems;
  mode: 'view' | 'edit';
  setMode: (mode: 'view' | 'edit') => void;
  showFilters: boolean;
  setShowFilters: (show: boolean) => void;
  onExport: () => void;
  onRefresh: () => void;
}

export default function BOQViewerHeader({
  boqData,
  mode,
  setMode,
  showFilters,
  setShowFilters,
  onExport,
  onRefresh
}: BOQViewerHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">
          {boqData.title || boqData.fileName || 'BOQ Viewer'}
        </h2>
        <div className="flex items-center space-x-4 mt-1">
          <span className="text-sm text-[var(--ff-text-secondary)]">
            Version {boqData.version}
          </span>
          <span className={getStatusBadge(boqData.status, 'mapping')}>
            {boqData.status.replace('_', ' ').toUpperCase()}
          </span>
          <span className="text-sm text-[var(--ff-text-secondary)]">
            {boqData.itemCount} items
          </span>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`px-3 py-2 border rounded-md text-sm font-medium flex items-center ${
            showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
          }`}
        >
          <Filter className="h-4 w-4 mr-2" />
          Filters
        </button>

        <button
          onClick={onExport}
          className="px-3 py-2 border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] rounded-md text-sm font-medium hover:bg-[var(--ff-bg-hover)] flex items-center"
        >
          <Download className="h-4 w-4 mr-2" />
          Export
        </button>

        <button
          onClick={() => setMode(mode === 'view' ? 'edit' : 'view')}
          className={`px-3 py-2 rounded-md text-sm font-medium flex items-center ${
            mode === 'edit'
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
          }`}
        >
          {mode === 'edit' ? (
            <>
              <Eye className="h-4 w-4 mr-2" />
              View Mode
            </>
          ) : (
            <>
              <Edit3 className="h-4 w-4 mr-2" />
              Edit Mode
            </>
          )}
        </button>

        <button
          onClick={onRefresh}
          className="px-3 py-2 border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] rounded-md text-sm font-medium hover:bg-[var(--ff-bg-hover)] flex items-center"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </button>
      </div>
    </div>
  );
}