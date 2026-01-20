// Standard UI Components for consistent module design
export { StandardModuleHeader } from './StandardModuleHeader';
export { StandardSummaryCards } from './StandardSummaryCards';
export { StandardSearchFilter } from './StandardSearchFilter';
export { StandardDataTable, Pagination } from './StandardDataTable';
export { StandardActionButtons } from './StandardActionButtons';

// NEW: Unified UI Components (following UI/UX Specification)
// @see docs/UI_UX_SPECIFICATION.md
export { StatCard, StatCardGrid, STAT_CARD_COLORS } from './StatCard';
export type { StatCardProps, StatCardGridProps, StatCardColorType } from './StatCard';

export { Badge, StatusBadge, PriorityBadge, CountBadge, BADGE_COLORS, PRIORITY_COLORS } from './Badge';
export type { BadgeProps, StatusBadgeProps, PriorityBadgeProps, CountBadgeProps, BadgeVariant, BadgeSize } from './Badge';

export { DarkSelect, InlineSelect } from './DarkSelect';
export type { DarkSelectProps, InlineSelectProps, SelectOption, SelectOptionGroup, DarkSelectSize } from './DarkSelect';

// Radix UI Select (dark themed)
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select';

// Existing UI components
export { LoadingSpinner } from './LoadingSpinner';

// VELOCITY Premium UI Components - Enhanced with theme integration
export { 
  GlassCard, 
  glassCardVariants 
} from './GlassCard';

export { 
  VelocityButton, 
  velocityButtonVariants 
} from './VelocityButton';

export { 
  VelocityInput, 
  velocityInputVariants 
} from './VelocityInput/index';

export { 
  VelocitySpinner, 
  velocitySpinnerVariants 
} from './VelocitySpinner';

export { 
  PageTransition, 
  withPageTransition, 
  RouteTransition,
  usePageTransition 
} from './PageTransition';

// Standard UI Component Types
export type { SummaryCardData } from './StandardSummaryCards';
export type { TableColumn } from './StandardDataTable';

// VELOCITY Premium UI Component Types
export type { GlassCardProps } from './GlassCard';
export type { VelocityButtonProps } from './VelocityButton';
export type { VelocityInputProps } from './VelocityInput/index';
export type { VelocitySpinnerProps } from './VelocitySpinner';
export type { 
  PageTransitionProps, 
  RouteTransitionProps, 
  TransitionType 
} from './PageTransition';