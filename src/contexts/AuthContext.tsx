import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { AuthUser } from '@/services/authService';
import {
  User,
  UserRole,
  Permission,
  LoginCredentials,
  RegisterCredentials,
  PasswordResetRequest,
  ChangePasswordRequest,
  ROLE_PERMISSIONS,
} from '@/types/auth.types';
import { resetAuthErrorHandler } from '@/lib/authErrorHandler';

interface AuthContextType {
  // Legacy properties for backward compatibility
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;

  // Enhanced properties with RBAC
  currentUser: User | null;
  isAuthenticated: boolean;
  signInWithEmailEnhanced: (credentials: LoginCredentials) => Promise<void>;
  signInWithGoogleEnhanced: (rememberMe?: boolean) => Promise<void>;
  registerWithEmail: (credentials: RegisterCredentials) => Promise<void>;
  resetPasswordEnhanced: (request: PasswordResetRequest) => Promise<void>;
  changePassword: (request: ChangePasswordRequest) => Promise<void>;
  sendEmailVerification: () => Promise<void>;
  updateProfile: (updates: Partial<User>) => Promise<void>;

  // Permission checking methods
  hasPermission: (permission: Permission) => boolean;
  hasAnyPermission: (permissions: Permission[]) => boolean;
  hasAllPermissions: (permissions: Permission[]) => boolean;
  hasRole: (role: UserRole) => boolean;
  hasAnyRole: (roles: UserRole[]) => boolean;

  // Utility methods
  clearError: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Map API role to UserRole enum
function mapRole(role: string): UserRole {
  const roleMap: Record<string, UserRole> = {
    'system': UserRole.SUPER_ADMIN,
    'super_admin': UserRole.SUPER_ADMIN,
    'admin': UserRole.ADMIN,
    'manager': UserRole.PROJECT_MANAGER,
    'technician': UserRole.FIELD_TECHNICIAN,
    'viewer': UserRole.VIEWER,
  };
  return roleMap[role] || UserRole.VIEWER;
}

// Map API user to internal User type
function mapApiUser(apiUser: {
  id: string;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  role: string;
  permissions: string[];
  profilePicture?: string | null;
  isImpersonation?: boolean;
}): { user: User; authUser: AuthUser } {
  const role = mapRole(apiUser.role);
  const permissions = apiUser.permissions.includes('all')
    ? ['all' as Permission, ...Object.values(Permission)]
    : (apiUser.permissions as Permission[]);

  // Build display name from firstName/lastName or fall back to name or email
  const displayName = apiUser.firstName && apiUser.lastName
    ? `${apiUser.firstName} ${apiUser.lastName}`
    : apiUser.name ?? apiUser.email;

  const user: User = {
    id: apiUser.id,
    email: apiUser.email,
    displayName,
    photoURL: apiUser.profilePicture || null,
    role,
    permissions,
    isEmailVerified: true,
    lastLoginAt: new Date(),
    createdAt: new Date(),
    isImpersonation: apiUser.isImpersonation ?? false,
  };

  const authUser: AuthUser = {
    uid: apiUser.id,
    email: apiUser.email,
    displayName,
    photoURL: apiUser.profilePicture || null,
    emailVerified: true,
  };

  return { user, authUser };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check auth status on mount
  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        // API returns { success, data: { user } } structure
        const userData = data.data?.user || data.user;
        const { user: mappedUser, authUser } = mapApiUser(userData);
        setUser(authUser);
        setCurrentUser(mappedUser);
        setIsAuthenticated(true);
      } else {
        setUser(null);
        setCurrentUser(null);
        setIsAuthenticated(false);
      }
    } catch {
      setUser(null);
      setCurrentUser(null);
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();

    // Reset the redirect handler when component mounts (in case of page reload after redirect)
    resetAuthErrorHandler();
  }, [checkAuth]);

  // Legacy sign in method
  const signInWithEmail = async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Login failed');
      }

      // API returns { success, data: { user } } structure
      const userData = data.data?.user || data.user;
      const { user: mappedUser, authUser } = mapApiUser(userData);
      setUser(authUser);
      setCurrentUser(mappedUser);
      setIsAuthenticated(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    setError('Google sign-in is not available. Please use email/password.');
    throw new Error('Google sign-in not implemented');
  };

  const signUp = async (_email: string, _password: string, _displayName?: string) => {
    setError('Registration is not available. Please contact an administrator.');
    throw new Error('Registration not implemented');
  };

  const resetPassword = async (_email: string) => {
    setError('Password reset is not available. Please contact an administrator.');
    throw new Error('Password reset not implemented');
  };

  // Enhanced methods with RBAC
  const signInWithEmailEnhanced = async (credentials: LoginCredentials) => {
    await signInWithEmail(credentials.email, credentials.password);
  };

  const signInWithGoogleEnhanced = async (_rememberMe = false) => {
    await signInWithGoogle();
  };

  const registerWithEmail = async (_credentials: RegisterCredentials) => {
    setError('Registration is not available. Please contact an administrator.');
    throw new Error('Registration not implemented');
  };

  const signOut = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      setUser(null);
      setCurrentUser(null);
      setIsAuthenticated(false);
      // Redirect to sign-in page
      if (typeof window !== 'undefined') {
        window.location.href = '/sign-in';
      }
    }
  };

  const resetPasswordEnhanced = async (_request: PasswordResetRequest) => {
    await resetPassword(_request.email);
  };

  const changePassword = async (_request: ChangePasswordRequest) => {
    setError('Password change is not available yet.');
    throw new Error('Password change not implemented');
  };

  const sendEmailVerification = async () => {
    setError('Email verification is not available.');
    throw new Error('Email verification not implemented');
  };

  const updateProfile = async (_updates: Partial<User>) => {
    setError('Profile update is not available yet.');
    throw new Error('Profile update not implemented');
  };

  // Permission checking methods
  const hasPermission = (permission: Permission): boolean => {
    if (!currentUser) return false;

    // Check if user has 'all' permission (super admin)
    if (currentUser.permissions.includes(Permission.SYSTEM_ADMIN)) return true;

    // Check role-based permissions
    const rolePermissions = ROLE_PERMISSIONS[currentUser.role] || [];
    if (rolePermissions.includes(permission)) return true;

    // Check direct permissions
    return currentUser.permissions.includes(permission);
  };

  const hasAnyPermission = (permissions: Permission[]): boolean => {
    if (!currentUser) return false;
    return permissions.some(p => hasPermission(p));
  };

  const hasAllPermissions = (permissions: Permission[]): boolean => {
    if (!currentUser) return false;
    return permissions.every(p => hasPermission(p));
  };

  const hasRole = (role: UserRole): boolean => {
    if (!currentUser) return false;
    return currentUser.role === role;
  };

  const hasAnyRole = (roles: UserRole[]): boolean => {
    if (!currentUser) return false;
    return roles.includes(currentUser.role);
  };

  // Utility methods
  const clearError = () => {
    setError(null);
  };

  const refreshUser = async () => {
    await checkAuth();
  };

  const value: AuthContextType = {
    // Legacy properties for backward compatibility
    user,
    loading,
    error,
    signInWithEmail,
    signInWithGoogle,
    signUp,
    signOut,
    resetPassword,

    // Enhanced properties with RBAC
    currentUser,
    isAuthenticated,
    signInWithEmailEnhanced,
    signInWithGoogleEnhanced,
    registerWithEmail,
    resetPasswordEnhanced,
    changePassword,
    sendEmailVerification,
    updateProfile,

    // Permission checking methods
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    hasRole,
    hasAnyRole,

    // Utility methods
    clearError,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
