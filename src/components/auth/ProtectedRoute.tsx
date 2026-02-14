import { ReactNode } from 'react';
// import { Navigate, useLocation } from 'react-router-dom';
// import { useAuth } from '@/contexts/AuthContext';
import { Permission, UserRole } from '@/types/auth.types';
// import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAuth?: boolean;
  requiredPermissions?: Permission[];
  requiredRoles?: UserRole[];
  requireAllPermissions?: boolean; // If true, user must have ALL permissions. If false, user needs ANY permission
  fallbackPath?: string;
  unauthorizedComponent?: ReactNode;
}

export function ProtectedRoute({
  children,
  // Commented out unused props for development mode
  // requireAuth = true,
  // requiredPermissions = [],
  // requiredRoles = [],
  // requireAllPermissions = false,
  // fallbackPath = '/login',
  // unauthorizedComponent,
}: ProtectedRouteProps) {
  // DEVELOPMENT MODE: Bypass authentication for easier testing
  // TODO: Remove this bypass when implementing RBAC
  return <>{children}</>;

  // Original auth logic (commented out for development)
  /*
  const { 
    currentUser, 
    isAuthenticated, 
    loading, 
    hasAnyPermission, 
    hasAllPermissions, 
    hasAnyRole 
  } = useAuth();
  const location = useLocation();

  // Show loading spinner while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Check if authentication is required
  if (requireAuth && !isAuthenticated) {
    // Redirect to login with return path
    return <Navigate to={fallbackPath} state={{ from: location }} replace />;
  }

  // If authenticated but no user data, something is wrong
  if (requireAuth && isAuthenticated && !currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">
            Loading user data...
          </h2>
          <p className="text-muted-foreground">Please wait while we verify your account.</p>
        </div>
      </div>
    );
  }

  // Check role requirements
  if (requiredRoles.length > 0 && currentUser) {
    const hasRequiredRole = hasAnyRole(requiredRoles);
    if (!hasRequiredRole) {
      if (unauthorizedComponent) {
        return <>{unauthorizedComponent}</>;
      }
      return <UnauthorizedComponent requiredRoles={requiredRoles} />;
    }
  }

  // Check permission requirements
  if (requiredPermissions.length > 0 && currentUser) {
    const hasRequiredPermissions = requireAllPermissions
      ? hasAllPermissions(requiredPermissions)
      : hasAnyPermission(requiredPermissions);

    if (!hasRequiredPermissions) {
      if (unauthorizedComponent) {
        return <>{unauthorizedComponent}</>;
      }
      return (
        <UnauthorizedComponent 
          requiredPermissions={requiredPermissions}
          requireAll={requireAllPermissions}
        />
      );
    }
  }

  // User has all required permissions and roles
  return <>{children}</>;
  */
}

// DEVELOPMENT MODE: UnauthorizedComponent commented out
// TODO: Restore when implementing RBAC
/*
interface UnauthorizedComponentProps {
  requiredRoles?: UserRole[];
  requiredPermissions?: Permission[];
  requireAll?: boolean;
}

function UnauthorizedComponent({ 
  requiredRoles, 
  requiredPermissions, 
  requireAll = false 
}: UnauthorizedComponentProps) {
  const { currentUser, signOut } = useAuth();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      log.error('Error signing out:', { data: error }, 'ProtectedRoute');
    }
  };

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
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h2>
          <p className="text-muted-foreground mb-4">
            You don't have the required permissions to access this page.
          </p>
        </div>

        {currentUser && (
          <div className="bg-background rounded-lg p-4 mb-6 text-left">
            <h3 className="font-medium text-foreground mb-2">Your Current Access:</h3>
            <div className="text-sm text-muted-foreground">
              <p><strong>Role:</strong> {currentUser.role.replace('_', ' ').toUpperCase()}</p>
              <p><strong>Email:</strong> {currentUser.email}</p>
            </div>
          </div>
        )}

        {requiredRoles && requiredRoles.length > 0 && (
          <div className="bg-blue-50 rounded-lg p-4 mb-4 text-left">
            <h4 className="font-medium text-blue-900 mb-2">Required Roles:</h4>
            <ul className="text-sm text-blue-700">
              {requiredRoles.map((role) => (
                <li key={role}>• {role.replace('_', ' ').toUpperCase()}</li>
              ))}
            </ul>
          </div>
        )}

        {requiredPermissions && requiredPermissions.length > 0 && (
          <div className="bg-blue-50 rounded-lg p-4 mb-6 text-left">
            <h4 className="font-medium text-blue-900 mb-2">
              Required Permissions {requireAll ? '(All)' : '(Any)'}:
            </h4>
            <ul className="text-sm text-blue-700">
              {requiredPermissions.map((permission) => (
                <li key={permission}>• {permission.replace('_', ' ').replace('.', ' ')}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={() => window.history.back()}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Go Back
          </button>
          <button
            onClick={handleSignOut}
            className="w-full bg-secondary text-foreground py-2 px-4 rounded-lg hover:bg-gray-300 transition-colors"
          >
            Sign Out
          </button>
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          Contact your administrator to request access to this feature.
        </p>
      </div>
    </div>
  );
}
*/

// Convenience components for common use cases
export function AdminRoute({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute 
      requiredRoles={[UserRole.SUPER_ADMIN, UserRole.ADMIN]}
    >
      {children}
    </ProtectedRoute>
  );
}

export function ManagerRoute({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute 
      requiredRoles={[
        UserRole.SUPER_ADMIN, 
        UserRole.ADMIN, 
        UserRole.PROJECT_MANAGER
      ]}
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