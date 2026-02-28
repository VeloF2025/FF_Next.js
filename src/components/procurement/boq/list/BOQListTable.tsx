/**
 * BOQ List Table Component — project-focused list view
 */

import { useRef, useEffect, useState } from 'react';
import {
  MoreVertical,
  Eye,
  Edit3,
  Download,
  Archive,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Clock
} from 'lucide-react';
import { BOQ } from '@/types/procurement/boq.types';
import { BOQ_STATUS_COLORS, MAPPING_STATUS_COLORS } from './BOQListTypes';

interface BOQListTableProps {
  boqs: BOQ[];
  selectedBOQId?: string;
  onView: (boq: BOQ) => void;
  onEdit: (boq: BOQ) => void;
  onDownload: (boq: BOQ) => void;
  onArchive: (boq: BOQ) => void;
  onDelete: (boq: BOQ) => void;
  onClick: (boq: BOQ) => void;
}

function ActionMenu({ onView, onEdit, onDownload, onArchive, onDelete }: {
  onView: () => void;
  onEdit: () => void;
  onDownload: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
    return () => {};
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="p-1 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 bg-[var(--ff-bg-secondary)] rounded-md shadow-lg border border-[var(--ff-border-light)] z-10">
          <div className="py-1">
            <button onClick={(e) => { e.stopPropagation(); onView(); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] flex items-center">
              <Eye className="h-4 w-4 mr-2" /> View Details
            </button>
            <button onClick={(e) => { e.stopPropagation(); onEdit(); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] flex items-center">
              <Edit3 className="h-4 w-4 mr-2" /> Edit BOQ
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDownload(); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] flex items-center">
              <Download className="h-4 w-4 mr-2" /> Download
            </button>
            <div className="border-t border-[var(--ff-border-light)]" />
            <button onClick={(e) => { e.stopPropagation(); onArchive(); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] flex items-center">
              <Archive className="h-4 w-4 mr-2" /> Archive
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 flex items-center">
              <Trash2 className="h-4 w-4 mr-2" /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function getMappingIcon(status: string) {
  switch (status) {
    case 'mapped':
    case 'completed':
      return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
    case 'in_progress':
    case 'mapping':
      return <Clock className="h-3.5 w-3.5 text-yellow-500" />;
    case 'exception':
      return <AlertTriangle className="h-3.5 w-3.5 text-red-500" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

const formatCurrency = (val: number) =>
  val > 0
    ? `R ${val.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : '—';

export default function BOQListTable({
  boqs,
  selectedBOQId,
  onView,
  onEdit,
  onDownload,
  onArchive,
  onDelete,
  onClick
}: BOQListTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)]">
            <th className="text-left px-4 py-3 font-medium text-[var(--ff-text-secondary)]">Name</th>
            <th className="text-left px-4 py-3 font-medium text-[var(--ff-text-secondary)]">Project</th>
            <th className="text-left px-4 py-3 font-medium text-[var(--ff-text-secondary)]">Status</th>
            <th className="text-right px-4 py-3 font-medium text-[var(--ff-text-secondary)]">Items</th>
            <th className="text-left px-4 py-3 font-medium text-[var(--ff-text-secondary)]">Mapping</th>
            <th className="text-right px-4 py-3 font-medium text-[var(--ff-text-secondary)]">Est. Value</th>
            <th className="text-left px-4 py-3 font-medium text-[var(--ff-text-secondary)]">Date</th>
            <th className="w-10 px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {boqs.map(boq => {
            const mappingPct = boq.itemCount > 0
              ? Math.round(((boq.mappedItems || 0) / boq.itemCount) * 100)
              : 0;
            const mappingStatus = boq.mappingStatus || 'pending';
            const mapped = boq.mappedItems || 0;
            const unmapped = boq.unmappedItems || 0;

            return (
              <tr
                key={boq.id}
                onClick={() => onClick(boq)}
                className={`border-b border-[var(--ff-border-light)] cursor-pointer hover:bg-[var(--ff-bg-hover)] transition-colors ${
                  selectedBOQId === boq.id ? 'bg-blue-500/10' : ''
                }`}
              >
                {/* Name */}
                <td className="px-4 py-3">
                  <span className="font-medium text-[var(--ff-text-primary)]">
                    {boq.title || boq.fileName || boq.name}
                  </span>
                </td>

                {/* Project */}
                <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                  {boq.projectName || '—'}
                </td>

                {/* Status */}
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${BOQ_STATUS_COLORS[boq.status]}`}>
                    {boq.status.charAt(0).toUpperCase() + boq.status.slice(1)}
                  </span>
                </td>

                {/* Items breakdown */}
                <td className="px-4 py-3 text-right">
                  <span className="text-[var(--ff-text-primary)] font-medium">{boq.itemCount || 0}</span>
                  <span className="text-xs text-[var(--ff-text-tertiary)] ml-1">
                    ({mapped}/{unmapped})
                  </span>
                </td>

                {/* Mapping progress */}
                <td className="px-4 py-3">
                  <div className="flex items-center space-x-2">
                    {getMappingIcon(mappingStatus)}
                    <div className="flex items-center space-x-1.5">
                      <div className="w-16 bg-[var(--ff-bg-hover)] rounded-full h-1.5">
                        <div
                          className="bg-blue-600 h-1.5 rounded-full"
                          style={{ width: `${mappingPct}%` }}
                        />
                      </div>
                      <span className="text-xs text-[var(--ff-text-secondary)] w-8">{mappingPct}%</span>
                    </div>
                  </div>
                </td>

                {/* Value */}
                <td className="px-4 py-3 text-right text-[var(--ff-text-secondary)]">
                  {formatCurrency(boq.totalEstimatedValue || 0)}
                </td>

                {/* Date */}
                <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                  {new Date(boq.createdAt).toISOString().split('T')[0]}
                </td>

                {/* Actions */}
                <td className="px-4 py-3">
                  <ActionMenu
                    onView={() => onView(boq)}
                    onEdit={() => onEdit(boq)}
                    onDownload={() => onDownload(boq)}
                    onArchive={() => onArchive(boq)}
                    onDelete={() => onDelete(boq)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}