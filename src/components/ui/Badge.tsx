/**
 * Badge - Unified badge component
 *
 * Following FibreFlow UI/UX Specification:
 * - Status badges: UPPERCASE (ACTIVE, PENDING, DRAFT)
 * - Type badges: Title Case (High Priority, Fiber Cable)
 * - Consistent color mapping across the app
 *
 * @see docs/UI_UX_SPECIFICATION.md
 */

import { ReactNode } from 'react';

// Color mappings for different status values
export const BADGE_COLORS = {
  // Success/Active states (green)
  active: 'bg-green-500/20 text-green-400',
  approved: 'bg-green-500/20 text-green-400',
  completed: 'bg-green-500/20 text-green-400',
  success: 'bg-green-500/20 text-green-400',
  delivered: 'bg-green-500/20 text-green-400',
  verified: 'bg-green-500/20 text-green-400',
  available: 'bg-green-500/20 text-green-400',
  paid: 'bg-green-500/20 text-green-400',
  fulfilled: 'bg-green-500/20 text-green-400',
  acknowledged: 'bg-green-500/20 text-green-400',

  // Warning/Pending states (yellow)
  pending: 'bg-yellow-500/20 text-yellow-400',
  'pending_approval': 'bg-yellow-500/20 text-yellow-400',
  'in-progress': 'bg-yellow-500/20 text-yellow-400',
  'in_progress': 'bg-yellow-500/20 text-yellow-400',
  inprogress: 'bg-yellow-500/20 text-yellow-400',
  processing: 'bg-yellow-500/20 text-yellow-400',
  partial: 'bg-yellow-500/20 text-yellow-400',
  'on-leave': 'bg-yellow-500/20 text-yellow-400',
  busy: 'bg-yellow-500/20 text-yellow-400',

  // Draft/New states (gray)
  draft: 'bg-gray-500/20 text-gray-400',
  new: 'bg-gray-500/20 text-gray-400',
  inactive: 'bg-gray-500/20 text-gray-400',
  unknown: 'bg-gray-500/20 text-gray-400',
  none: 'bg-gray-500/20 text-gray-400',

  // Error/Danger states (red)
  error: 'bg-red-500/20 text-red-400',
  cancelled: 'bg-red-500/20 text-red-400',
  rejected: 'bg-red-500/20 text-red-400',
  failed: 'bg-red-500/20 text-red-400',
  expired: 'bg-red-500/20 text-red-400',
  overdue: 'bg-red-500/20 text-red-400',
  critical: 'bg-red-500/20 text-red-400',

  // Info/Blue states
  info: 'bg-blue-500/20 text-blue-400',
  sent: 'bg-blue-500/20 text-blue-400',
  ordered: 'bg-blue-500/20 text-blue-400',
  submitted: 'bg-blue-500/20 text-blue-400',

  // Orange states
  warning: 'bg-orange-500/20 text-orange-400',
  'on-hold': 'bg-orange-500/20 text-orange-400',
  suspended: 'bg-orange-500/20 text-orange-400',
  shipped: 'bg-orange-500/20 text-orange-400',

  // Purple states
  planning: 'bg-purple-500/20 text-purple-400',
  scheduled: 'bg-purple-500/20 text-purple-400',

  // Cyan states
  progress: 'bg-cyan-500/20 text-cyan-400',
} as const;

// Priority colors
export const PRIORITY_COLORS = {
  low: 'bg-gray-500/20 text-gray-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  high: 'bg-orange-500/20 text-orange-400',
  critical: 'bg-red-500/20 text-red-400',
  urgent: 'bg-red-500/20 text-red-400',
} as const;

export type BadgeVariant = 'status' | 'priority' | 'type' | 'count' | 'custom';
export type BadgeSize = 'sm' | 'md' | 'lg';

export interface BadgeProps {
  /** The text to display */
  children: ReactNode;
  /** Badge variant determines casing and color logic */
  variant?: BadgeVariant;
  /** Size variant */
  size?: BadgeSize;
  /** Custom color classes (overrides automatic color) */
  colorClass?: string;
  /** Icon to show before text */
  icon?: ReactNode;
  /** Dot indicator before text */
  dot?: boolean;
  /** Dot color class */
  dotColor?: string;
  /** Additional className */
  className?: string;
  /** Force specific text casing */
  casing?: 'uppercase' | 'capitalize' | 'lowercase' | 'none';
}

/**
 * Get color class based on status value
 */
function getStatusColor(status: string): string {
  const normalized = status.toLowerCase().replace(/[\s_]+/g, '-');
  return BADGE_COLORS[normalized as keyof typeof BADGE_COLORS] || 'bg-gray-500/20 text-gray-400';
}

/**
 * Get color class based on priority value
 */
function getPriorityColor(priority: string): string {
  const normalized = priority.toLowerCase();
  return PRIORITY_COLORS[normalized as keyof typeof PRIORITY_COLORS] || 'bg-gray-500/20 text-gray-400';
}

/**
 * Format text based on variant
 */
function formatText(text: string, variant: BadgeVariant, casing?: BadgeProps['casing']): string {
  // If explicit casing is set, use that
  if (casing) {
    switch (casing) {
      case 'uppercase': return text.toUpperCase();
      case 'capitalize': return text.replace(/\b\w/g, l => l.toUpperCase());
      case 'lowercase': return text.toLowerCase();
      case 'none': return text;
    }
  }

  // Default casing based on variant
  switch (variant) {
    case 'status':
      return text.toUpperCase();
    case 'priority':
      return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    case 'type':
      return text.replace(/\b\w/g, l => l.toUpperCase());
    case 'count':
    case 'custom':
    default:
      return text;
  }
}

export function Badge({
  children,
  variant = 'status',
  size = 'md',
  colorClass,
  icon,
  dot,
  dotColor = 'bg-current',
  className = '',
  casing,
}: BadgeProps) {
  // Get the text content for color matching
  const textContent = typeof children === 'string' ? children : '';

  // Determine color based on variant
  let finalColorClass = colorClass;
  if (!finalColorClass) {
    switch (variant) {
      case 'status':
        finalColorClass = getStatusColor(textContent);
        break;
      case 'priority':
        finalColorClass = getPriorityColor(textContent);
        break;
      case 'count':
        finalColorClass = 'bg-blue-500/20 text-blue-400';
        break;
      case 'type':
      case 'custom':
      default:
        finalColorClass = 'bg-gray-500/20 text-gray-400';
        break;
    }
  }

  // Size classes
  const sizeClasses = {
    sm: 'px-1.5 py-0.5 text-[10px]',
    md: 'px-2 py-1 text-xs',
    lg: 'px-3 py-1.5 text-sm',
  };

  // Format display text
  const displayContent = typeof children === 'string'
    ? formatText(children, variant, casing)
    : children;

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 font-medium rounded
        ${sizeClasses[size]}
        ${finalColorClass}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {dot && (
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      )}
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {displayContent}
    </span>
  );
}

// Convenience components for common use cases

export interface StatusBadgeProps {
  status: string;
  size?: BadgeSize;
  className?: string;
}

export function StatusBadge({ status, size = 'md', className }: StatusBadgeProps) {
  return (
    <Badge variant="status" size={size} className={className}>
      {status}
    </Badge>
  );
}

export interface PriorityBadgeProps {
  priority: string;
  size?: BadgeSize;
  className?: string;
}

export function PriorityBadge({ priority, size = 'md', className }: PriorityBadgeProps) {
  return (
    <Badge variant="priority" size={size} className={className}>
      {priority}
    </Badge>
  );
}

export interface CountBadgeProps {
  count: number;
  size?: BadgeSize;
  className?: string;
}

export function CountBadge({ count, size = 'sm', className }: CountBadgeProps) {
  return (
    <Badge variant="count" size={size} className={className}>
      {count.toLocaleString()}
    </Badge>
  );
}

export default Badge;
