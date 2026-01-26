/**
 * ModulePage Types
 */

import type { ModuleNavigationConfig, TabBadge } from '@/modules/navigation';

/**
 * Props for ModulePage component
 */
export interface ModulePageProps {
  /** Module navigation configuration */
  config: ModuleNavigationConfig;
  /** Page content */
  children: React.ReactNode;
  /** Tab badges (overrides static config badges) */
  tabBadges?: Record<string, TabBadge>;
  /** Loading state */
  isLoading?: boolean;
  /** Custom header actions (rendered in header right side) */
  headerActions?: React.ReactNode;
  /** Hide the module header (tabs still shown) */
  hideHeader?: boolean;
  /** Hide tabs (for detail pages) */
  hideTabs?: boolean;
  /** Additional class for content wrapper */
  contentClassName?: string;
}

/**
 * Props for ModuleHeader component
 */
export interface ModuleHeaderProps {
  /** Module title */
  title: string;
  /** Module description/subtitle */
  description?: string;
  /** Module icon */
  icon?: React.ComponentType<{ className?: string }>;
  /** Header actions (right side) */
  actions?: React.ReactNode;
  /** Show project selector */
  showProjectSelector?: boolean;
}
