/**
 * usePermission Hook
 * Client-side permission checking for React components
 *
 * Usage:
 *   const { can, canAny, canAll, isLoading } = usePermission();
 *
 *   if (can('procurement.sourcing', 'edit')) { ... }
 *   if (canAny(['projects.list', 'activate.main'], 'view')) { ... }
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete';

export interface EffectivePermission {
  permissionKey: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

interface UsePermissionReturn {
  /**
   * Check if user can perform action on permission
   */
  can: (permissionKey: string, action?: PermissionAction) => boolean;

  /**
   * Check if user can perform action on ANY of the permissions
   */
  canAny: (permissionKeys: string[], action?: PermissionAction) => boolean;

  /**
   * Check if user can perform action on ALL of the permissions
   */
  canAll: (permissionKeys: string[], action?: PermissionAction) => boolean;

  /**
   * Check if user can view a module (shorthand for can(key, 'view'))
   */
  canViewModule: (moduleKey: string) => boolean;

  /**
   * Check if user can access a page
   */
  canAccessPage: (pageKey: string) => boolean;

  /**
   * Get all effective permissions for current user
   */
  permissions: EffectivePermission[];

  /**
   * Loading state while fetching permissions
   */
  isLoading: boolean;

  /**
   * Refresh permissions from server
   */
  refresh: () => Promise<void>;
}

export function usePermission(): UsePermissionReturn {
  const { currentUser, isAuthenticated } = useAuth();
  const [permissions, setPermissions] = useState<EffectivePermission[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Check if user is super admin with 'all' permission
  const isSuperAdmin = useMemo(() => {
    if (!currentUser) return false;
    return currentUser.permissions?.includes('all') || currentUser.role === 'super_admin';
  }, [currentUser]);

  // Fetch permissions from API
  const fetchPermissions = useCallback(async () => {
    if (!isAuthenticated || !currentUser?.id) {
      setPermissions([]);
      setIsLoading(false);
      return;
    }

    // Super admin has all permissions - no need to fetch
    if (isSuperAdmin) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch('/api/admin/permissions/me');

      if (response.ok) {
        const data = await response.json();
        setPermissions(data.data || []);
      } else {
        // Fallback: if API fails, assume role-based permissions
        setPermissions([]);
      }
    } catch (error) {
      console.error('Failed to fetch permissions:', error);
      setPermissions([]);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, currentUser?.id, isSuperAdmin]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  // Build permission lookup map
  const permissionMap = useMemo(() => {
    const map = new Map<string, EffectivePermission>();
    for (const perm of permissions) {
      map.set(perm.permissionKey, perm);
    }
    return map;
  }, [permissions]);

  // Check single permission
  const can = useCallback(
    (permissionKey: string, action: PermissionAction = 'view'): boolean => {
      // Super admin can do everything
      if (isSuperAdmin) return true;

      const perm = permissionMap.get(permissionKey);
      if (!perm) return false;

      switch (action) {
        case 'view':
          return perm.canView;
        case 'create':
          return perm.canCreate;
        case 'edit':
          return perm.canEdit;
        case 'delete':
          return perm.canDelete;
        default:
          return false;
      }
    },
    [isSuperAdmin, permissionMap]
  );

  // Check any permission
  const canAny = useCallback(
    (permissionKeys: string[], action: PermissionAction = 'view'): boolean => {
      if (isSuperAdmin) return true;
      return permissionKeys.some(key => can(key, action));
    },
    [isSuperAdmin, can]
  );

  // Check all permissions
  const canAll = useCallback(
    (permissionKeys: string[], action: PermissionAction = 'view'): boolean => {
      if (isSuperAdmin) return true;
      return permissionKeys.every(key => can(key, action));
    },
    [isSuperAdmin, can]
  );

  // Shorthand for module view
  const canViewModule = useCallback(
    (moduleKey: string): boolean => can(moduleKey, 'view'),
    [can]
  );

  // Shorthand for page access
  const canAccessPage = useCallback(
    (pageKey: string): boolean => can(pageKey, 'view'),
    [can]
  );

  return {
    can,
    canAny,
    canAll,
    canViewModule,
    canAccessPage,
    permissions,
    isLoading,
    refresh: fetchPermissions,
  };
}

/**
 * Hook to check a single permission (simpler interface)
 *
 * Usage:
 *   const canEdit = useCanDo('procurement.sourcing', 'edit');
 */
export function useCanDo(
  permissionKey: string,
  action: PermissionAction = 'view'
): boolean {
  const { can } = usePermission();
  return can(permissionKey, action);
}

/**
 * Hook to get accessible modules for the current user
 */
export function useAccessibleModules(): string[] {
  const { permissions, isLoading } = usePermission();
  const { currentUser } = useAuth();

  return useMemo(() => {
    if (isLoading) return [];

    // Super admin can access all modules
    if (currentUser?.permissions?.includes('all') || currentUser?.role === 'super_admin') {
      return [
        'dashboard',
        'projects',
        'activate',
        'field',
        'maintenance',
        'people',
        'clients',
        'contractors',
        'procurement',
        'assets',
        'fleet',
        'communications',
        'analytics',
        'system',
      ];
    }

    // Filter to module-level permissions where user can view
    return permissions
      .filter(p => !p.permissionKey.includes('.') && p.canView)
      .map(p => p.permissionKey);
  }, [permissions, isLoading, currentUser]);
}

export default usePermission;
