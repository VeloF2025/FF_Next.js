/**
 * TicketActions Component - Ticket action buttons
 *
 * 🟢 WORKING: Production-ready ticket actions component
 *
 * Features:
 * - Status change actions
 * - Assignment actions
 * - Delete/cancel actions
 * - Context-aware button display based on ticket status
 * - Confirmation dialogs for destructive actions
 * - Loading states during mutations
 */

'use client';

import React, { useState } from 'react';
import {
  Trash2,
  CheckCircle2,
  Clock,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUpdateTicket, useDeleteTicket } from '../../hooks/useTicket';
import type { EnrichedTicket, TicketStatus } from '../../types/ticket';

interface TicketActionsProps {
  /** Ticket data */
  ticket: EnrichedTicket;
  /** Compact mode */
  compact?: boolean;
  /** Callback when action completes */
  onActionComplete?: () => void;
}

/**
 * 🟢 WORKING: Ticket actions component
 * Note: Assignment is now handled by the separate AssignmentPanel component
 */
export function TicketActions({ ticket, compact = false, onActionComplete }: TicketActionsProps) {
  const updateTicket = useUpdateTicket();
  const deleteTicket = useDeleteTicket();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 🟢 WORKING: Handle status change
  const handleStatusChange = (newStatus: TicketStatus) => {
    updateTicket.mutate(
      {
        id: ticket.id,
        payload: { status: newStatus },
      },
      {
        onSuccess: () => {
          if (onActionComplete) {
            onActionComplete();
          }
        },
      }
    );
  };

  // 🟢 WORKING: Handle delete
  const handleDelete = () => {
    deleteTicket.mutate(ticket.id, {
      onSuccess: () => {
        setShowDeleteConfirm(false);
        if (onActionComplete) {
          onActionComplete();
        }
      },
    });
  };

  // 🟢 WORKING: Get available actions based on status
  // Note: Assignment actions are now in AssignmentPanel
  const getAvailableActions = () => {
    const actions = [];

    // Status-specific actions
    if (ticket.status === 'open') {
      actions.push({
        label: 'Start Work',
        icon: Clock,
        onClick: () => handleStatusChange('in_progress'),
        variant: 'primary' as const,
      });
    }

    if (ticket.status === 'in_progress') {
      actions.push({
        label: 'Submit for QA',
        icon: ArrowRight,
        onClick: () => handleStatusChange('pending_qa'),
        variant: 'primary' as const,
      });
    }

    if (ticket.status === 'qa_approved') {
      actions.push({
        label: 'Ready for Handover',
        icon: CheckCircle2,
        onClick: () => handleStatusChange('pending_handover'),
        variant: 'primary' as const,
      });
    }

    if (ticket.status === 'qa_rejected') {
      actions.push({
        label: 'Resume Work',
        icon: Clock,
        onClick: () => handleStatusChange('in_progress'),
        variant: 'primary' as const,
      });
    }

    return actions;
  };

  const availableActions = getAvailableActions();
  const isLoading = updateTicket.isPending || deleteTicket.isPending;

  return (
    <div className="space-y-4">
      {/* Action Buttons */}
      {availableActions.length > 0 && (
        <div className={cn('flex flex-wrap gap-2', compact && 'flex-col')}>
          {availableActions.map((action) => {
            const Icon = action.icon;
            const isPrimary = action.variant === 'primary';

            return (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                disabled={isLoading}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                  isPrimary
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                )}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
                {action.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Delete Action */}
      {!showDeleteConfirm ? (
        <button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-4 h-4" />
          Delete Ticket
        </button>
      ) : (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <p className="text-sm text-red-300 mb-3">
            Are you sure you want to delete this ticket? This action cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              Confirm Delete
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              disabled={isLoading}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
