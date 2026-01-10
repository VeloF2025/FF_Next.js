import { useNavigate } from 'react-router-dom';
import { Eye, Edit, Trash2, Download, Archive, MoreVertical } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface StandardActionButtonsProps {
  id: string;
  module: string; // e.g., 'clients', 'projects', 'staff'
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onDownload?: () => void;
  onArchive?: () => void;
  showView?: boolean;
  showEdit?: boolean;
  showDelete?: boolean;
  showDownload?: boolean;
  showArchive?: boolean;
  showMore?: boolean;
  moreActions?: Array<{
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
    onClick: () => void;
    className?: string;
  }>;
}

export function StandardActionButtons({
  id,
  module,
  onView,
  onEdit,
  onDelete,
  onDownload,
  onArchive,
  showView = true,
  showEdit = true,
  showDelete = true,
  showDownload = false,
  showArchive = false,
  showMore = false,
  moreActions = []
}: StandardActionButtonsProps) {
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleView = () => {
    if (onView) {
      onView();
    } else {
      navigate(`/app/${module}/${id}`);
    }
  };

  const handleEdit = () => {
    if (onEdit) {
      onEdit();
    } else {
      navigate(`/app/${module}/${id}/edit`);
    }
  };

  const handleDelete = () => {
    if (onDelete) {
      onDelete();
    }
  };

  return (
    <div className="flex items-center gap-2">
      {showView && (
        <button
          onClick={handleView}
          className="p-1 text-[var(--ff-text-secondary)] hover:text-blue-400 transition-colors"
          title="View"
        >
          <Eye className="h-4 w-4" />
        </button>
      )}

      {showEdit && (
        <button
          onClick={handleEdit}
          className="p-1 text-[var(--ff-text-secondary)] hover:text-blue-400 transition-colors"
          title="Edit"
        >
          <Edit className="h-4 w-4" />
        </button>
      )}

      {showDelete && (
        <button
          onClick={handleDelete}
          className="p-1 text-[var(--ff-text-secondary)] hover:text-red-400 transition-colors"
          title="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}

      {showDownload && onDownload && (
        <button
          onClick={onDownload}
          className="p-1 text-[var(--ff-text-secondary)] hover:text-blue-400 transition-colors"
          title="Download"
        >
          <Download className="h-4 w-4" />
        </button>
      )}

      {showArchive && onArchive && (
        <button
          onClick={onArchive}
          className="p-1 text-[var(--ff-text-secondary)] hover:text-yellow-400 transition-colors"
          title="Archive"
        >
          <Archive className="h-4 w-4" />
        </button>
      )}

      {(showMore || moreActions.length > 0) && (
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="p-1 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
            title="More actions"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {showDropdown && (
            <div className="absolute right-0 mt-2 w-48 bg-[var(--ff-bg-secondary)] rounded-lg shadow-lg border border-[var(--ff-border-light)] z-10">
              <div className="py-1">
                {moreActions.map((action, index) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={index}
                      onClick={() => {
                        action.onClick();
                        setShowDropdown(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-[var(--ff-bg-hover)] flex items-center gap-2 ${
                        action.className || 'text-[var(--ff-text-primary)]'
                      }`}
                    >
                      {Icon && <Icon className="h-4 w-4" />}
                      {action.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Status Badge Component
interface StatusBadgeProps {
  status: string;
  variant?: 'default' | 'outline' | 'solid';
}

export function StatusBadge({ status, variant: _ = 'default' }: StatusBadgeProps) {
  const statusColors: Record<string, string> = {
    // General statuses
    active: 'bg-green-500/20 text-green-400',
    inactive: 'bg-gray-500/20 text-gray-400',
    pending: 'bg-yellow-500/20 text-yellow-400',
    completed: 'bg-blue-500/20 text-blue-400',
    cancelled: 'bg-red-500/20 text-red-400',
    approved: 'bg-green-500/20 text-green-400',
    rejected: 'bg-red-500/20 text-red-400',
    draft: 'bg-gray-500/20 text-gray-400',

    // Project specific
    planning: 'bg-purple-500/20 text-purple-400',
    'in-progress': 'bg-blue-500/20 text-blue-400',
    'on-hold': 'bg-orange-500/20 text-orange-400',

    // Staff specific
    available: 'bg-green-500/20 text-green-400',
    'on-leave': 'bg-yellow-500/20 text-yellow-400',
    busy: 'bg-red-500/20 text-red-400',

    // Procurement specific
    ordered: 'bg-blue-500/20 text-blue-400',
    delivered: 'bg-green-500/20 text-green-400',
    processing: 'bg-yellow-500/20 text-yellow-400'
  };

  const colorClass = statusColors[status.toLowerCase().replace(/\s+/g, '-')] || 'bg-gray-500/20 text-gray-400';

  return (
    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${colorClass}`}>
      {status}
    </span>
  );
}

// Priority Badge Component
interface PriorityBadgeProps {
  priority: 'low' | 'medium' | 'high' | 'critical' | string;
}

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  const priorityColors: Record<string, string> = {
    low: 'bg-gray-500/20 text-gray-400',
    medium: 'bg-yellow-500/20 text-yellow-400',
    high: 'bg-orange-500/20 text-orange-400',
    critical: 'bg-red-500/20 text-red-400',
    urgent: 'bg-red-500/20 text-red-400'
  };

  const colorClass = priorityColors[priority.toLowerCase()] || 'bg-gray-500/20 text-gray-400';

  return (
    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${colorClass}`}>
      {priority}
    </span>
  );
}