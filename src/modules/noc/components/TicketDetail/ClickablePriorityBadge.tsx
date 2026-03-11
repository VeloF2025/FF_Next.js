/**
 * ClickablePriorityBadge Component - Interactive priority badge with dropdown
 *
 * Features:
 * - Click to open priority dropdown
 * - Priority change via API
 * - Loading state during update
 * - Color-coded priority levels
 */

'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Circle,
  Flame,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ClickablePriorityBadgeProps {
  /** Current ticket priority */
  priority: string;
  /** Ticket ID for API update */
  ticketId: string;
  /** Callback when priority changes */
  onPriorityChange?: (newPriority: string) => void;
  /** Show icon */
  showIcon?: boolean;
}

/**
 * Priority configuration with styling
 */
interface PriorityOption {
  code: string;
  name: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

const PRIORITY_OPTIONS: PriorityOption[] = [
  {
    code: 'low',
    name: 'Low',
    color: '#6B7280',
    bgColor: 'rgba(107, 114, 128, 0.2)',
    borderColor: 'rgba(107, 114, 128, 0.3)',
    icon: Circle,
    description: 'Non-urgent, can wait',
  },
  {
    code: 'normal',
    name: 'Normal',
    color: '#3B82F6',
    bgColor: 'rgba(59, 130, 246, 0.2)',
    borderColor: 'rgba(59, 130, 246, 0.3)',
    icon: Circle,
    description: 'Standard priority',
  },
  {
    code: 'medium',
    name: 'Medium',
    color: '#3B82F6',
    bgColor: 'rgba(59, 130, 246, 0.2)',
    borderColor: 'rgba(59, 130, 246, 0.3)',
    icon: Circle,
    description: 'Standard priority',
  },
  {
    code: 'high',
    name: 'High',
    color: '#F97316',
    bgColor: 'rgba(249, 115, 22, 0.2)',
    borderColor: 'rgba(249, 115, 22, 0.3)',
    icon: AlertTriangle,
    description: 'Needs attention soon',
  },
  {
    code: 'urgent',
    name: 'Urgent',
    color: '#EF4444',
    bgColor: 'rgba(239, 68, 68, 0.2)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    icon: AlertCircle,
    description: 'Requires immediate attention',
  },
  {
    code: 'critical',
    name: 'Critical',
    color: '#DC2626',
    bgColor: 'rgba(220, 38, 38, 0.2)',
    borderColor: 'rgba(220, 38, 38, 0.3)',
    icon: Flame,
    description: 'Service impacting emergency',
  },
];

// Deduplicated options for dropdown (exclude 'medium' as alias for 'normal')
const DROPDOWN_OPTIONS = PRIORITY_OPTIONS.filter(p => p.code !== 'medium');

// Default config for fallback (normal priority)
const DEFAULT_CONFIG: PriorityOption = {
  code: 'normal',
  name: 'Normal',
  color: '#3B82F6',
  bgColor: 'rgba(59, 130, 246, 0.2)',
  borderColor: 'rgba(59, 130, 246, 0.3)',
  icon: Circle,
  description: 'Standard priority',
};

/**
 * Clickable priority badge with dropdown
 */
export function ClickablePriorityBadge({
  priority,
  ticketId,
  onPriorityChange,
  showIcon = true,
}: ClickablePriorityBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [currentPriority, setCurrentPriority] = useState(priority);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Find current priority config with guaranteed fallback
  const currentConfig: PriorityOption = PRIORITY_OPTIONS.find((p) => p.code === currentPriority) ?? DEFAULT_CONFIG;
  const Icon = currentConfig.icon;

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

  // Update local priority when prop changes
  useEffect(() => {
    setCurrentPriority(priority);
  }, [priority]);

  const handlePriorityChange = async (newPriority: string) => {
    if (newPriority === currentPriority || isUpdating) return;

    setIsUpdating(true);
    setIsOpen(false);

    try {
      const response = await fetch(`/api/noc/tickets/${ticketId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: newPriority }),
      });

      if (!response.ok) {
        throw new Error('Failed to update priority');
      }

      setCurrentPriority(newPriority);
      onPriorityChange?.(newPriority);
    } catch {
      // Revert on error - priority unchanged
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
          backgroundColor: currentConfig.bgColor,
          borderColor: currentConfig.borderColor,
          color: currentConfig.color,
        }}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition-all cursor-pointer uppercase',
          !isUpdating && 'hover:opacity-80',
          isUpdating && 'opacity-70 cursor-wait'
        )}
        aria-label={`Priority: ${currentConfig.name}. Click to change.`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {isUpdating ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          showIcon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        )}
        <span>{currentConfig.name}</span>
        <ChevronDown className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute top-full left-0 mt-1 w-52 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-lg z-50 py-1 max-h-64 overflow-y-auto"
          role="listbox"
          aria-label="Select priority"
        >
          {DROPDOWN_OPTIONS.map((priorityOption) => {
            const OptionIcon = priorityOption.icon;
            const isSelected = priorityOption.code === currentPriority;

            return (
              <button
                key={priorityOption.code}
                type="button"
                onClick={() => handlePriorityChange(priorityOption.code)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                  isSelected
                    ? 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]'
                    : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] hover:text-[var(--ff-text-primary)]'
                )}
                role="option"
                aria-selected={isSelected}
                title={priorityOption.description}
              >
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded"
                  style={{
                    backgroundColor: priorityOption.bgColor,
                    color: priorityOption.color,
                  }}
                >
                  <OptionIcon className="w-3 h-3" />
                </span>
                <div className="flex-1">
                  <span className="block">{priorityOption.name}</span>
                  <span className="block text-xs text-[var(--ff-text-muted)]">
                    {priorityOption.description}
                  </span>
                </div>
                {isSelected && <CheckCircle2 className="w-4 h-4 text-green-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
