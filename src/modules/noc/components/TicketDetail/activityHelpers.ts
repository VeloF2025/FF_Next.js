/**
 * Icon / label / colour helpers + type-narrow predicate for the
 * NOC ticket-detail ActivityTab. Split out of ActivityTab.tsx to keep
 * each file under the 300-line CLAUDE.md limit.
 */

import {
  MessageSquare,
  Edit,
  UserPlus,
  Activity,
  StickyNote,
  Sparkles,
} from 'lucide-react';
import type { TicketActivity } from '../../hooks/useTicketActivities';

export function getActivityIcon(type: TicketActivity['type']) {
  switch (type) {
    case 'note':
      return StickyNote;
    case 'update':
    case 'status_change':
      return Edit;
    case 'assignment':
      return UserPlus;
    case 'message':
      return MessageSquare;
    case 'ai_summary':
      return Sparkles;
    case 'system':
    default:
      return Activity;
  }
}

export function getActivityTypeLabel(type: TicketActivity['type']): string {
  switch (type) {
    case 'note':
      return 'Note';
    case 'update':
      return 'Update';
    case 'status_change':
      return 'Status Change';
    case 'assignment':
      return 'Assignment';
    case 'message':
      return 'Message';
    case 'ai_summary':
      return 'AI History';
    case 'system':
      return 'System';
    default:
      return 'Activity';
  }
}

export function getActivityTypeColor(type: TicketActivity['type']): string {
  switch (type) {
    case 'note':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'update':
    case 'status_change':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'assignment':
      return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    case 'message':
      return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'ai_summary':
      return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
    case 'system':
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

/**
 * Type-narrow helper for the legacy per-update field-changes shape.
 * `field_changes` on `ai_summary` rows holds an audit object — not an array.
 */
export function isFieldChangeArray(
  fc: TicketActivity['field_changes'],
): fc is Array<{ field: string; old_value?: string; new_value: string }> {
  return Array.isArray(fc);
}
