/**
 * PermissionGate Component
 * Conditionally renders children based on user permissions
 *
 * Usage:
 *   <PermissionGate permission="procurement.sourcing" action="edit">
 *     <EditButton />
 *   </PermissionGate>
 *
 *   <PermissionGate permissions={['projects.list', 'activate.main']} requireAll={false}>
 *     <SomeContent />
 *   </PermissionGate>
 */

import React, { ReactNode } from 'react';
import { usePermission, PermissionAction } from '@/hooks/usePermission';

interface PermissionGateProps {
  /**
   * Single permission key to check
   */
  permission?: string;

  /**
   * Multiple permission keys to check
   */
  permissions?: string[];

  /**
   * Action to check (default: 'view')
   */
  action?: PermissionAction;

  /**
   * If true, user must have ALL permissions. If false, ANY permission is sufficient.
   * Default: false (any)
   */
  requireAll?: boolean;

  /**
   * Content to render when user has permission
   */
  children: ReactNode;

  /**
   * Content to render when user lacks permission
   * Default: null (render nothing)
   */
  fallback?: ReactNode;

  /**
   * If true, show loading state while checking permissions
   * Default: false
   */
  showLoading?: boolean;

  /**
   * Custom loading component
   */
  loadingComponent?: ReactNode;
}

export function PermissionGate({
  permission,
  permissions,
  action = 'view',
  requireAll = false,
  children,
  fallback = null,
  showLoading = false,
  loadingComponent,
}: PermissionGateProps): React.ReactElement | null {
  const { can, canAny, canAll, isLoading } = usePermission();

  // Handle loading state
  if (isLoading && showLoading) {
    return (loadingComponent as React.ReactElement) || (
      <div className="animate-pulse h-4 w-24 bg-gray-200 rounded" />
    );
  }

  // Determine permission keys to check
  const keysToCheck = permission ? [permission] : (permissions || []);

  if (keysToCheck.length === 0) {
    // No permissions specified - render children
    return <>{children}</>;
  }

  // Check permissions
  let hasPermission: boolean;
  if (keysToCheck.length === 1) {
    hasPermission = can(keysToCheck[0], action);
  } else if (requireAll) {
    hasPermission = canAll(keysToCheck, action);
  } else {
    hasPermission = canAny(keysToCheck, action);
  }

  // Render based on permission check
  if (hasPermission) {
    return <>{children}</>;
  }

  return fallback ? <>{fallback}</> : null;
}

/**
 * Higher-order component version of PermissionGate
 *
 * Usage:
 *   const ProtectedComponent = withPermission(MyComponent, 'procurement.sourcing', 'edit');
 */
export function withPermission<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  permission: string,
  action: PermissionAction = 'view',
  fallback?: ReactNode
) {
  return function PermissionProtectedComponent(props: P) {
    return (
      <PermissionGate permission={permission} action={action} fallback={fallback}>
        <WrappedComponent {...props} />
      </PermissionGate>
    );
  };
}

/**
 * Component to show access denied message
 */
export function AccessDenied({
  message = 'You do not have permission to access this content.',
  showBackButton = true,
}: {
  message?: string;
  showBackButton?: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] p-8 text-center">
      <div className="w-16 h-16 mb-4 rounded-full bg-red-100 flex items-center justify-center">
        <svg
          className="w-8 h-8 text-red-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
      <p className="text-gray-600 mb-4 max-w-md">{message}</p>
      {showBackButton && (
        <button
          onClick={() => window.history.back()}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
        >
          Go Back
        </button>
      )}
    </div>
  );
}

/**
 * Protected page wrapper - shows AccessDenied if user lacks permission
 */
export function ProtectedPage({
  permission,
  action = 'view',
  children,
}: {
  permission: string;
  action?: PermissionAction;
  children: ReactNode;
}): React.ReactElement {
  return (
    <PermissionGate
      permission={permission}
      action={action}
      fallback={<AccessDenied />}
      showLoading
      loadingComponent={
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
        </div>
      }
    >
      {children}
    </PermissionGate>
  );
}

export default PermissionGate;
