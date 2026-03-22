// WORKING: ProtectedRoute — enforces auth and RBAC for Next.js Pages Router
import { ReactNode } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { Permission, UserRole } from '@/types/auth.types';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAuth?: boolean;
  requiredPermissions?: Permission[];
  requiredRoles?: UserRole[];
  requireAllPermissions?: boolean; // If true, user must have ALL permissions. If false, user needs ANY permission
  fallbackPath?: string;
  unauthorizedComponent?: ReactNode;
}

/**
 * Renders a simple "access denied" message when the user lacks required
 * roles or permissions. Provides a Go Back button via window.history.
 */
function UnauthorizedMessage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full bg-card rounded-lg shadow-md p-8 text-center">
        <div className="mb-6">
          <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Access Denied</h2>
          <p className="text-muted-foreground mb-4">
            You don&apos;t have the required permissions to access this page.
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => window.history.back()}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Go Back
          </button>
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          Contact your administrator to request access to this feature.
        </p>
      </div>
    </div>
  );
}

/**
 * Wraps routes with authentication and RBAC enforcement using Next.js
 * navigation primitives. Redirects unauthenticated visitors to the
 * fallback path; renders UnauthorizedMessage for insufficient permissions.
 */
export function ProtectedRoute({
  children,
  requireAuth = true,
  requiredPermissions = [],
  requiredRoles = [],
  requireAllPermissions = false,
  fallbackPath = '/login',
  unauthorizedComponent,
}: ProtectedRouteProps) {
  const { currentUser, isAuthenticated, loading, hasAnyPermission, hasAllPermissions, hasAnyRole } =
    useAuth();
  const router = useRouter();

  // Show loading indicator while the auth state resolves
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // Redirect unauthenticated visitors to the login page
  if (requireAuth && !isAuthenticated) {
    router.replace(fallbackPath);
    return null;
  }

  // Check role requirements
  if (requiredRoles.length > 0 && currentUser) {
    if (!hasAnyRole(requiredRoles)) {
      if (unauthorizedComponent) return <>{unauthorizedComponent}</>;
      return <UnauthorizedMessage />;
    }
  }

  // Check permission requirements
  if (requiredPermissions.length > 0 && currentUser) {
    const hasPerms = requireAllPermissions
      ? hasAllPermissions(requiredPermissions)
      : hasAnyPermission(requiredPermissions);

    if (!hasPerms) {
      if (unauthorizedComponent) return <>{unauthorizedComponent}</>;
      return <UnauthorizedMessage />;
    }
  }

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Convenience wrappers for common role gates
// ---------------------------------------------------------------------------

export function AdminRoute({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute requiredRoles={[UserRole.SUPER_ADMIN, UserRole.ADMIN]}>
      {children}
    </ProtectedRoute>
  );
}

export function ManagerRoute({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute
      requiredRoles={[UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.PROJECT_MANAGER]}
    >
      {children}
    </ProtectedRoute>
  );
}

export function StaffRoute({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute
      requiredRoles={[
        UserRole.SUPER_ADMIN,
        UserRole.ADMIN,
        UserRole.PROJECT_MANAGER,
        UserRole.SITE_SUPERVISOR,
        UserRole.FIELD_TECHNICIAN,
      ]}
    >
      {children}
    </ProtectedRoute>
  );
}
