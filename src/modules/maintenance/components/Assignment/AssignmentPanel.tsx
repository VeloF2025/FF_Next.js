/**
 * AssignmentPanel Component - Combined assignment UI
 *
 * Features:
 * - User and Team selection in one panel
 * - Shows current assignment status
 * - Quick "Assign to Me" action
 * - Save button with loading state
 * - Compact and expanded modes
 * - Shows assignee avatar and team badge
 */

'use client';

import React, { useState, useCallback } from 'react';
import { User, Users, UserPlus, Save, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { UserSelector } from './UserSelector';
import { TeamSelector } from './TeamSelector';
import { useAssignTicket } from '../../hooks/useAssignment';
import type { UserDropdownOption, TeamDropdownOption } from '../../types/team';

interface AssignmentPanelProps {
  /** Ticket ID */
  ticketId: string;
  /** Current assigned user ID */
  currentUserId?: string | null;
  /** Current assigned user name */
  currentUserName?: string | null;
  /** Current assigned team ID */
  currentTeamId?: string | null;
  /** Current assigned team name */
  currentTeamName?: string | null;
  /** Callback when assignment is saved */
  onAssignmentSaved?: () => void;
  /** Compact mode for sidebar/card display */
  compact?: boolean;
  /** Show panel title */
  showTitle?: boolean;
}

export function AssignmentPanel({
  ticketId,
  currentUserId = null,
  currentUserName = null,
  currentTeamId = null,
  currentTeamName = null,
  onAssignmentSaved,
  compact = false,
  showTitle = true,
}: AssignmentPanelProps) {
  const { user } = useAuth();
  const assignTicket = useAssignTicket();

  // Local state for selection (before saving)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(currentUserId);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(currentTeamId);
  const [selectedUserName, setSelectedUserName] = useState<string | null>(currentUserName);
  const [selectedTeamName, setSelectedTeamName] = useState<string | null>(currentTeamName);
  const [isEditing, setIsEditing] = useState(false);

  // Check if there are unsaved changes
  const hasChanges = selectedUserId !== currentUserId || selectedTeamId !== currentTeamId;

  // Handle user selection
  const handleUserChange = useCallback((userId: string | null, userOption?: UserDropdownOption) => {
    setSelectedUserId(userId);
    setSelectedUserName(userOption?.name || null);
    if (!isEditing) setIsEditing(true);
  }, [isEditing]);

  // Handle team selection
  const handleTeamChange = useCallback((teamId: string | null, teamOption?: TeamDropdownOption) => {
    setSelectedTeamId(teamId);
    setSelectedTeamName(teamOption?.name || null);
    if (!isEditing) setIsEditing(true);
  }, [isEditing]);

  // Handle "Assign to Me" quick action
  const handleAssignToMe = useCallback(() => {
    if (!user?.uid) return;

    assignTicket.mutate(
      {
        ticketId,
        assigned_to: user.uid,
        assigned_team_id: currentTeamId,
      },
      {
        onSuccess: () => {
          setSelectedUserId(user.uid);
          setSelectedUserName(user.displayName || user.email || 'Me');
          setIsEditing(false);
          onAssignmentSaved?.();
        },
      }
    );
  }, [user, ticketId, currentTeamId, assignTicket, onAssignmentSaved]);

  // Handle save assignment
  const handleSave = useCallback(() => {
    assignTicket.mutate(
      {
        ticketId,
        assigned_to: selectedUserId,
        assigned_team_id: selectedTeamId,
      },
      {
        onSuccess: () => {
          setIsEditing(false);
          onAssignmentSaved?.();
        },
      }
    );
  }, [ticketId, selectedUserId, selectedTeamId, assignTicket, onAssignmentSaved]);

  // Handle cancel editing
  const handleCancel = useCallback(() => {
    setSelectedUserId(currentUserId);
    setSelectedTeamId(currentTeamId);
    setSelectedUserName(currentUserName);
    setSelectedTeamName(currentTeamName);
    setIsEditing(false);
  }, [currentUserId, currentTeamId, currentUserName, currentTeamName]);

  const isLoading = assignTicket.isPending;
  const isAssignedToMe = currentUserId === user?.uid;

  return (
    <div className={cn(
      'bg-[var(--ff-bg-card)] rounded-lg border border-[var(--ff-border-light)]',
      compact ? 'p-3' : 'p-4'
    )}>
      {/* Header */}
      {showTitle && (
        <div className="flex items-center justify-between mb-4">
          <h3 className={cn(
            'font-semibold text-[var(--ff-text-primary)]',
            compact ? 'text-sm' : 'text-base'
          )}>
            Assignment
          </h3>
          {!isEditing && !compact && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      )}

      {/* Current Assignment Status (when not editing in compact mode) */}
      {!isEditing && compact && (currentUserName || currentTeamName) && (
        <div className="mb-3 space-y-2">
          {currentUserName && (
            <div className="flex items-center gap-2 text-sm">
              <div className="w-6 h-6 rounded-full bg-[var(--ff-bg-tertiary)] flex items-center justify-center">
                <User className="w-3.5 h-3.5 text-[var(--ff-text-tertiary)]" />
              </div>
              <span className="text-[var(--ff-text-primary)]">{currentUserName}</span>
              {isAssignedToMe && (
                <span className="text-xs text-green-400">(You)</span>
              )}
            </div>
          )}
          {currentTeamName && (
            <div className="flex items-center gap-2 text-sm">
              <div className="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Users className="w-3.5 h-3.5 text-blue-400" />
              </div>
              <span className="text-[var(--ff-text-primary)]">{currentTeamName}</span>
            </div>
          )}
        </div>
      )}

      {/* Selectors (always visible when editing or not compact) */}
      {(isEditing || !compact) && (
        <div className={cn('space-y-4', compact && 'space-y-3')}>
          {/* User Selector */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[var(--ff-text-secondary)]">
              Assigned To
            </label>
            <UserSelector
              value={selectedUserId}
              onChange={handleUserChange}
              placeholder="Select user..."
              disabled={isLoading}
              compact={compact}
            />
          </div>

          {/* Team Selector */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[var(--ff-text-secondary)]">
              Team
            </label>
            <TeamSelector
              value={selectedTeamId}
              onChange={handleTeamChange}
              placeholder="Select team..."
              disabled={isLoading}
              compact={compact}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className={cn(
        'flex flex-wrap gap-2',
        (isEditing || !compact) ? 'mt-4' : 'mt-2'
      )}>
        {/* Assign to Me (only if not already assigned to me) */}
        {!isAssignedToMe && (
          <button
            type="button"
            onClick={handleAssignToMe}
            disabled={isLoading}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              'bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)]',
              'border border-[var(--ff-border-light)]',
              'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {isLoading && assignTicket.variables?.assigned_to === user?.uid ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <UserPlus className="w-3.5 h-3.5" />
            )}
            Assign to Me
          </button>
        )}

        {/* Save Button (only when there are changes) */}
        {hasChanges && (
          <>
            <button
              type="button"
              onClick={handleSave}
              disabled={isLoading}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                'bg-blue-600 hover:bg-blue-700 text-white',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {isLoading && assignTicket.variables?.assigned_to !== user?.uid ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isLoading}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                'bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)]',
                'border border-[var(--ff-border-light)]',
                'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
          </>
        )}
      </div>

      {/* Error Message */}
      {assignTicket.isError && (
        <div className="mt-3 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-md">
          <p className="text-xs text-red-400">
            {assignTicket.error?.message || 'Failed to update assignment'}
          </p>
        </div>
      )}
    </div>
  );
}
