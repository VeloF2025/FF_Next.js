import type { NavSection, NavItem, SidebarStyles } from './types';
import type { ThemeConfig } from '@/types/theme.types';
import type { Permission } from '@/types/auth.types';
import type { PermissionAction } from '@/hooks/usePermission';

/**
 * Legacy filter using old Permission enum
 * @deprecated Use filterNavigationItemsRBAC instead
 */
export const filterNavigationItems = (
  navItems: NavSection[],
  hasPermission: (permission: Permission) => boolean
): NavSection[] => {
  return navItems.map(section => ({
    ...section,
    items: section.items.filter(item => {
      // If no permissions required, show to all authenticated users
      if (item.permissions.length === 0) return true;

      // Check if user has any of the required permissions
      return item.permissions.some(permission => hasPermission(permission));
    })
  })).filter(section => section.items.length > 0); // Remove empty sections
};

/**
 * Filter navigation items based on RBAC permission keys
 * Uses the new database-backed permission system
 *
 * @param navItems - Navigation sections to filter
 * @param can - Permission check function from usePermission hook
 * @returns Filtered navigation sections
 */
export const filterNavigationItemsRBAC = (
  navItems: NavSection[],
  can: (key: string, action?: PermissionAction) => boolean
): NavSection[] => {
  const filterItem = (item: NavItem): boolean => {
    // If no rbacKey, item is available to all authenticated users
    if (!item.rbacKey) return true;
    // Check if user can view this permission
    return can(item.rbacKey, 'view');
  };

  const filterSubItems = (item: NavItem): NavItem => {
    if (!item.subItems || item.subItems.length === 0) {
      return item;
    }
    return {
      ...item,
      subItems: item.subItems.filter(filterItem).map(filterSubItems),
    };
  };

  return navItems
    .map(section => ({
      ...section,
      items: section.items
        .filter(filterItem)
        .map(filterSubItems)
        .filter(item => {
          // Keep items that either have no subItems OR have visible subItems
          if (!item.subItems || item.subItems.length === 0) return true;
          return item.subItems.length > 0;
        }),
    }))
    .filter(section => section.items.length > 0); // Remove empty sections
};

export const getSidebarStyles = (themeConfig: ThemeConfig): SidebarStyles => {
  const baseStyles = themeConfig.name === 'vf' ? {
    backgroundColor: themeConfig.colors.surface.sidebar || themeConfig.colors.surface.primary,
    borderColor: themeConfig.colors.border.sidebar || themeConfig.colors.border.primary,
    textColor: themeConfig.colors.text.sidebarPrimary || themeConfig.colors.text.primary,
    textColorSecondary: themeConfig.colors.text.sidebarSecondary || themeConfig.colors.text.secondary,
    textColorTertiary: themeConfig.colors.text.sidebarTertiary || themeConfig.colors.text.tertiary
  } : {
    backgroundColor: themeConfig.colors.surface.primary,
    borderColor: themeConfig.colors.border.primary,
    textColor: themeConfig.colors.text.primary,
    textColorSecondary: themeConfig.colors.text.secondary,
    textColorTertiary: themeConfig.colors.text.tertiary
  };

  return baseStyles;
};