/**
 * BOQ Card Component — project-focused layout
 */

import { useRef, useEffect } from 'react';
import {
  MoreVertical,
  Eye,
  Edit3,
  Download,
  Archive,
  Trash2,
  FileText,
  FolderOpen,
  AlertTriangle,
  DollarSign
} from 'lucide-react';
import { BOQ } from '@/types/procurement/boq.types';
import { BOQ_STATUS_COLORS } from './BOQListTypes';

interface BOQCardProps {
  boq: BOQ;
  isSelected?: boolean;
  onClick?: () => void;
  onView: () => void;
  onEdit: () => void;
  onDownload: () => void;
  onArchive: () => void;
  onDelete: () => void;
  actionMenuOpen: boolean;
  setActionMenuOpen: (open: boolean) => void;
}

export default function BOQCard({
  boq,
  isSelected = false,
  onClick,
  onView,
  onEdit,
  onDownload,
  onArchive,
  onDelete,
  actionMenuOpen,
  setActionMenuOpen
}: BOQCardProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActionMenuOpen(false);
      }
    };
    if (actionMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
    return () => {};
  }, [actionMenuOpen, setActionMenuOpen]);

  const mappingPct = boq.itemCount > 0
    ? Math.round(((boq.mappedItems || 0) / boq.itemCount) * 100)
    : 0;
  const mapped = boq.mappedItems || 0;
  const unmapped = boq.unmappedItems || 0;
  const exceptions = boq.exceptionsCount || 0;
  const estimatedValue = boq.totalEstimatedValue || 0;

  const formatCurrency = (val: number) =>
    val > 0
      ? `R ${val.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
      : '—';

  return (
    <div
      className={`bg-[var(--ff-bg-secondary)] rounded-lg border p-4 hover:shadow-md transition-shadow cursor-pointer flex flex-col ${
        isSelected ? 'border-blue-500 shadow-md' : 'border-[var(--ff-border-light)]'
      }`}
      onClick={onClick}
    >
      {/* Header: title + status + menu */}
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3 min-w-0 flex-1">
          <FileText className="h-5 w-5 text-blue-500 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-[var(--ff-text-primary)] truncate">
              {boq.title || boq.fileName}
            </h3>
            <div className="flex items-center space-x-2 mt-1">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${BOQ_STATUS_COLORS[boq.status]}`}>
                {boq.status.charAt(0).toUpperCase() + boq.status.slice(1)}
              </span>
              {boq.projectName && (
                <span className="flex items-center text-xs text-[var(--ff-text-secondary)] truncate">
                  <FolderOpen className="h-3 w-3 mr-1 flex-shrink-0" />
                  {boq.projectName}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Menu */}
        <div className="relative ml-2 flex-shrink-0" ref={menuRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setActionMenuOpen(!actionMenuOpen); }}
            className="p-1 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
          >
            <MoreVertical className="h-5 w-5" />
          </button>
          {actionMenuOpen && (
            <div className="absolute right-0 mt-1 w-44 bg-[var(--ff-bg-secondary)] rounded-md shadow-lg border border-[var(--ff-border-light)] z-10">
              <div className="py-1">
                <button onClick={(e) => { e.stopPropagation(); onView(); }}
                  className="w-full text-left px-3 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] flex items-center">
                  <Eye className="h-4 w-4 mr-2" /> View Details
                </button>
                <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
                  className="w-full text-left px-3 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] flex items-center">
                  <Edit3 className="h-4 w-4 mr-2" /> Edit BOQ
                </button>
                <button onClick={(e) => { e.stopPropagation(); onDownload(); }}
                  className="w-full text-left px-3 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] flex items-center">
                  <Download className="h-4 w-4 mr-2" /> Download
                </button>
                <div className="border-t border-[var(--ff-border-light)]" />
                <button onClick={(e) => { e.stopPropagation(); onArchive(); }}
                  className="w-full text-left px-3 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] flex items-center">
                  <Archive className="h-4 w-4 mr-2" /> Archive
                </button>
                <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 flex items-center">
                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quantities row */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="bg-[var(--ff-bg-hover)] rounded-md py-1.5 px-2">
          <div className="text-lg font-semibold text-[var(--ff-text-primary)]">{boq.itemCount || 0}</div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--ff-text-tertiary)]">Total Items</div>
        </div>
        <div className="bg-[var(--ff-bg-hover)] rounded-md py-1.5 px-2">
          <div className="text-lg font-semibold text-green-400">{mapped}</div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--ff-text-tertiary)]">Mapped</div>
        </div>
        <div className="bg-[var(--ff-bg-hover)] rounded-md py-1.5 px-2">
          <div className="text-lg font-semibold text-yellow-400">{unmapped}</div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--ff-text-tertiary)]">Unmapped</div>
        </div>
      </div>

      {/* Mapping progress bar */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-[var(--ff-text-secondary)]">Mapping progress</span>
          <span className="font-medium text-[var(--ff-text-primary)]">{mappingPct}%</span>
        </div>
        <div className="w-full bg-[var(--ff-bg-hover)] rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all"
            style={{ width: `${mappingPct}%` }}
          />
        </div>
      </div>

      {/* Footer: value + exceptions + date */}
      <div className="mt-3 flex items-center justify-between text-xs text-[var(--ff-text-secondary)]">
        <div className="flex items-center space-x-3">
          {estimatedValue > 0 && (
            <span className="flex items-center font-medium text-[var(--ff-text-primary)]">
              <DollarSign className="h-3 w-3 mr-0.5" />
              {formatCurrency(estimatedValue)}
            </span>
          )}
          {exceptions > 0 && (
            <span className="flex items-center text-red-400">
              <AlertTriangle className="h-3 w-3 mr-0.5" />
              {exceptions} exceptions
            </span>
          )}
        </div>
        <span>{new Date(boq.createdAt).toISOString().split('T')[0]}</span>
      </div>
    </div>
  );
}