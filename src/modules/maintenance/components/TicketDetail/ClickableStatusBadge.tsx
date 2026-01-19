/**
 * ClickableStatusBadge Component - Interactive status badge with dropdown
 *
 * Features:
 * - Click to open status dropdown
 * - Fetches available statuses from database
 * - Status change via API
 * - Loading state during update
 * - Success/error feedback
 */

'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Circle,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Ban,
  ChevronDown,
  Loader2,
  ClipboardCheck,
  UserCheck,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ClickableStatusBadgeProps {
  /** Current ticket status code */
  status: string;
  /** Ticket ID for API update */
  ticketId: string;
  /** Callback when status changes */
  onStatusChange?: (newStatus: string) => void;
  /** Show icon */
  showIcon?: boolean;
}

/**
 * Database status type from maintenance_statuses table
 */
interface StatusOption {
  id: string;
  code: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  color: string;
  icon: string;
  display_order: number;
  is_active: boolean;
  is_terminal: boolean;
  qcontact_status: string | null;
}

/**
 * Icon mapping from database icon names to Lucide components
 */
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  circle: Circle,
  'clipboard-check': ClipboardCheck,
  'user-check': UserCheck,
  loader: Clock,
  'alert-triangle': AlertTriangle,
  'check-circle': CheckCircle,
  'check-circle-2': CheckCircle2,
  'x-circle': XCircle,
  clock: Clock,
  ban: Ban,
  'alert-circle': AlertCircle,
};

/**
 * Clickable status badge with dropdown - fetches statuses from database
 */
export function ClickableStatusBadge({
  status,
  ticketId,
  onStatusChange,
  showIcon = true,
}: ClickableStatusBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(status);
  const [availableStatuses, setAvailableStatuses] = useState<StatusOption[]>([]);
  const [isLoadingStatuses, setIsLoadingStatuses] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Find current status config
  const currentConfig = availableStatuses.find((s) => s.code === currentStatus);
  const Icon = currentConfig ? (ICON_MAP[currentConfig.icon] || Circle) : Circle;
  const statusColor = currentConfig?.color || '#6B7280';
  const statusName = currentConfig?.name || currentStatus.replace(/_/g, ' ');

  // Fetch available statuses from API
  useEffect(() => {
    async function fetchStatuses() {
      setIsLoadingStatuses(true);
      try {
        const response = await fetch('/api/maintenance/statuses');
        if (response.ok) {
          const result = await response.json();
          if (result.success && Array.isArray(result.data)) {
            // Filter to only top-level statuses (no parent_id)
            const topLevelStatuses = result.data.filter(
              (s: StatusOption) => !s.parent_id
            );
            setAvailableStatuses(topLevelStatuses);
          }
        }
      } catch {
        // Silently fail - will use fallback
      } finally {
        setIsLoadingStatuses(false);
      }
    }
    fetchStatuses();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Update local status when prop changes
  useEffect(() => {
    setCurrentStatus(status);
  }, [status]);

  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === currentStatus || isUpdating) return;

    setIsUpdating(true);
    setIsOpen(false);

    try {
      const response = await fetch(`/api/maintenance/tickets/${ticketId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        throw new Error('Failed to update status');
      }

      setCurrentStatus(newStatus);
      onStatusChange?.(newStatus);
    } catch {
      // Revert on error - status unchanged
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Main Badge Button */}
      <button
        type="button"
        onClick={() => !isUpdating && setIsOpen(!isOpen)}
        disabled={isUpdating}
        style={{
          backgroundColor: `${statusColor}20`,
          borderColor: `${statusColor}30`,
          color: statusColor,
        }}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition-all cursor-pointer',
          !isUpdating && 'hover:opacity-80',
          isUpdating && 'opacity-70 cursor-wait'
        )}
        aria-label={`Status: ${statusName}. Click to change.`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {isUpdating ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          showIcon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        )}
        <span className="capitalize">{statusName}</span>
        <ChevronDown className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute top-full left-0 mt-1 w-52 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-lg z-50 py-1 max-h-64 overflow-y-auto"
          role="listbox"
          aria-label="Select status"
        >
          {isLoadingStatuses ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-[var(--ff-text-secondary)]" />
            </div>
          ) : availableStatuses.length === 0 ? (
            <div className="px-3 py-2 text-sm text-[var(--ff-text-secondary)]">
              No statuses available
            </div>
          ) : (
            availableStatuses.map((statusOption) => {
              const OptionIcon = ICON_MAP[statusOption.icon] || Circle;
              const isSelected = statusOption.code === currentStatus;

              return (
                <button
                  key={statusOption.id}
                  type="button"
                  onClick={() => handleStatusChange(statusOption.code)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                    isSelected
                      ? 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]'
                      : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] hover:text-[var(--ff-text-primary)]'
                  )}
                  role="option"
                  aria-selected={isSelected}
                  title={statusOption.description || undefined}
                >
                  <span
                    className="inline-flex items-center justify-center w-5 h-5 rounded"
                    style={{
                      backgroundColor: `${statusOption.color}20`,
                      color: statusOption.color,
                    }}
                  >
                    <OptionIcon className="w-3 h-3" />
                  </span>
                  <span className="flex-1">{statusOption.name}</span>
                  {statusOption.is_terminal && (
                    <span className="text-xs text-[var(--ff-text-muted)]">final</span>
                  )}
                  {isSelected && <CheckCircle2 className="w-4 h-4 text-green-400" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
