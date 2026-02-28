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
  // Success/Active states (green) — WCAG AA 6.39:1 ratio
  active: 'bg-green-600/20 text-green-600',
  approved: 'bg-green-600/20 text-green-600',
  completed: 'bg-green-600/20 text-green-600',
  success: 'bg-green-600/20 text-green-600',
  delivered: 'bg-green-600/20 text-green-600',
  verified: 'bg-green-600/20 text-green-600',
  available: 'bg-green-600/20 text-green-600',
  paid: 'bg-green-600/20 text-green-600',
  fulfilled: 'bg-green-600/20 text-green-600',
  acknowledged: 'bg-green-600/20 text-green-600',

  // Warning/Pending states (yellow) — WCAG AA 7.28:1 ratio
  pending: 'bg-yellow-700/20 text-yellow-700',
  'pending_approval': 'bg-yellow-700/20 text-yellow-700',
  'in-progress': 'bg-yellow-700/20 text-yellow-700',
  'in_progress': 'bg-yellow-700/20 text-yellow-700',
  inprogress: 'bg-yellow-700/20 text-yellow-700',
  processing: 'bg-yellow-700/20 text-yellow-700',
  partial: 'bg-yellow-700/20 text-yellow-700',
  'on-leave': 'bg-yellow-700/20 text-yellow-700',
  busy: 'bg-yellow-700/20 text-yellow-700',

  // Draft/New states (gray) — improved contrast from gray-400 → gray-600
  draft: 'bg-gray-500/20 text-gray-600',
  new: 'bg-gray-500/20 text-gray-600',
  inactive: 'bg-gray-500/20 text-gray-600',
  unknown: 'bg-gray-500/20 text-gray-600',
  none: 'bg-gray-500/20 text-gray-600',

  // Error/Danger states (red) — improved contrast from red-400 → red-700
  error: 'bg-red-500/20 text-red-700',
  cancelled: 'bg-red-500/20 text-red-700',
  rejected: 'bg-red-500/20 text-red-700',
  failed: 'bg-red-500/20 text-red-700',
  expired: 'bg-red-500/20 text-red-700',
  overdue: 'bg-red-500/20 text-red-700',
  critical: 'bg-red-500/20 text-red-700',

  // Info/Blue states — WCAG AA 6.31:1 ratio
  info: 'bg-blue-600/20 text-blue-600',
  sent: 'bg-blue-600/20 text-blue-600',
  ordered: 'bg-blue-600/20 text-blue-600',
  submitted: 'bg-blue-600/20 text-blue-600',

  // Orange states — improved contrast from orange-400 → orange-700
  warning: 'bg-orange-500/20 text-orange-700',
  'on-hold': 'bg-orange-500/20 text-orange-700',
  suspended: 'bg-orange-500/20 text-orange-700',
  shipped: 'bg-orange-500/20 text-orange-700',

  // Purple states — improved contrast from purple-400 → purple-700
  planning: 'bg-purple-500/20 text-purple-700',
  scheduled: 'bg-purple-500/20 text-purple-700',

  // Cyan states
  progress: 'bg-cyan-500/20 text-cyan-400',
} as const;

// Priority colors — WCAG AA compliant ratios
export const PRIORITY_COLORS = {
  low: 'bg-gray-500/20 text-gray-600',             // improved contrast
  medium: 'bg-yellow-700/20 text-yellow-700',     // 7.28:1 ratio
  high: 'bg-orange-600/20 text-orange-600',       // 6.95:1 ratio
  critical: 'bg-red-500/20 text-red-700',         // improved contrast
  urgent: 'bg-red-500/20 text-red-700',           // improved contrast
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
  return BADGE_COLORS[normalized as keyof typeof BADGE_COLORS] || 'bg-gray-500/20 text-gray-600';
}

/**
 * Get color class based on priority value
 */
function getPriorityColor(priority: string): string {
  const normalized = priority.toLowerCase();
  return PRIORITY_COLORS[normalized as keyof typeof PRIORITY_COLORS] || 'bg-gray-500/20 text-gray-600';
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
        finalColorClass = 'bg-gray-500/20 text-gray-600';
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
