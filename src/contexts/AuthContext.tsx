import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
// import { authService, AuthUser } from '@/services/authService'; // Commented out for development mode
import { AuthUser } from '@/services/authService';
import {
  User,
  UserRole,
  Permission,
  LoginCredentials,
  RegisterCredentials,
  PasswordResetRequest,
  ChangePasswordRequest,
} from '@/types/auth.types';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  // DEVELOPMENT MODE: Mock user data for easier testing
  // TODO: Remove this mock data when implementing RBAC
  // Use Hein van Vuuren's staff ID from database to satisfy foreign key constraints
  // NOTE: Using static dates to prevent SSR/CSR hydration mismatch (React error #418/#423)
  const mockUser: User = {
    id: 'ac59fe41-b52b-43f6-8b8e-a8d53c8d56f2',
    email: 'hein@velocityfibre.co.za',
    displayName: 'Hein van Vuuren',
    photoURL: null,
    role: UserRole.SUPER_ADMIN,
    permissions: [
      Permission.PROJECTS_READ,
      Permission.PROJECTS_CREATE,
      Permission.STAFF_READ,
      Permission.STAFF_CREATE,
      Permission.SYSTEM_ADMIN,
    ],
    isEmailVerified: true,
    lastLoginAt: new Date('2025-01-01T00:00:00.000Z'),
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  };

  const mockAuthUser: AuthUser = {
    uid: 'ac59fe41-b52b-43f6-8b8e-a8d53c8d56f2',
    email: 'hein@velocityfibre.co.za',
    displayName: 'Hein van Vuuren',
    photoURL: null,
    emailVerified: true,
  };

  // Legacy state for backward compatibility
  const [user] = useState<AuthUser | null>(mockAuthUser);
  const [loading] = useState(false); // No loading in dev mode
  const [error, setError] = useState<string | null>(null);
  
  // Enhanced state with RBAC
  const [currentUser] = useState<User | null>(mockUser);
  const [isAuthenticated] = useState(true); // Always authenticated in dev mode

  useEffect(() => {
    // DEVELOPMENT MODE: Skip Firebase auth listeners
    // TODO: Restore auth listeners when implementing RBAC
    /* 
    // Set up enhanced auth state listener
    const unsubscribeEnhanced = authService.onAuthStateChangedEnhanced((user) => {
      setCurrentUser(user);
      setIsAuthenticated(!!user);
      setLoading(false);
    });

    // Set up legacy auth state listener for backward compatibility
    const unsubscribeLegacy = authService.onAuthStateChanged((user) => {
      setUser(user);
    });

    return () => {
      unsubscribeEnhanced();
      unsubscribeLegacy();
    };
    */
  }, []);

  // DEVELOPMENT MODE: Mock auth methods
  // TODO: Restore real auth methods when implementing RBAC
  
  // Legacy methods for backward compatibility
  const signInWithEmail = async (_email: string, _password: string) => {
    // Mock implementation - silent in development mode
    // TODO: Implement real authentication
  };

  const signInWithGoogle = async () => {
    // Mock implementation - silent in development mode
    // TODO: Implement Google authentication
  };

  const signUp = async (_email: string, _password: string, _displayName?: string) => {
    // Mock implementation - silent in development mode
    // TODO: Implement user registration
  };

  const resetPassword = async (_email: string) => {
    // Mock implementation - silent in development mode
    // TODO: Implement password reset
  };

  // Enhanced methods with RBAC
  const signInWithEmailEnhanced = async (_credentials: LoginCredentials) => {
    // Mock implementation - silent in development mode
    // TODO: Implement enhanced email authentication
  };

  const signInWithGoogleEnhanced = async (_rememberMe = false) => {
    // Mock implementation - silent in development mode
    // TODO: Implement enhanced Google authentication
  };

  const registerWithEmail = async (_credentials: RegisterCredentials) => {
    // Mock implementation - silent in development mode
    // TODO: Implement enhanced email registration
  };

  const signOut = async () => {
    // Mock implementation - silent in development mode
    // TODO: Implement sign out functionality
  };

  const resetPasswordEnhanced = async (_request: PasswordResetRequest) => {
    // Mock implementation - silent in development mode
    // TODO: Implement enhanced password reset
  };

  const changePassword = async (_request: ChangePasswordRequest) => {
    // Mock implementation - silent in development mode
    // TODO: Implement password change functionality
  };

  const sendEmailVerification = async () => {
    // Mock implementation - silent in development mode
    // TODO: Implement email verification
  };

  const updateProfile = async (_updates: Partial<User>) => {
    // Mock implementation - silent in development mode
    // TODO: Implement profile update functionality
  };

  // Permission checking methods
  const hasPermission = (_permission: Permission): boolean => {
    // DEVELOPMENT MODE: Always return true for easier testing
    // TODO: Restore proper permission checking when implementing RBAC
    return true;
    
    // Original logic (commented out for development)
    /*
    if (!currentUser) return false;
    return authService.hasPermission(permission);
    */
  };

  const hasAnyPermission = (_permissions: Permission[]): boolean => {
    // DEVELOPMENT MODE: Always return true for easier testing
    return true;
    
    // Original logic (commented out for development)
    /*
    if (!currentUser) return false;
    return authService.hasAnyPermission(permissions);
    */
  };

  const hasAllPermissions = (_permissions: Permission[]): boolean => {
    // DEVELOPMENT MODE: Always return true for easier testing
    return true;
    
    // Original logic (commented out for development)
    /*
    if (!currentUser) return false;
    return authService.hasAllPermissions(permissions);
    */
  };

  const hasRole = (_role: UserRole): boolean => {
    // DEVELOPMENT MODE: Always return true for easier testing
    return true;
    
    // Original logic (commented out for development)
    /*
    if (!currentUser) return false;
    return authService.hasRole(role);
    */
  };

  const hasAnyRole = (_roles: UserRole[]): boolean => {
    // DEVELOPMENT MODE: Always return true for easier testing
    return true;
    
    // Original logic (commented out for development)
    /*
    if (!currentUser) return false;
    return currentUser?.role ? roles.includes(currentUser.role as UserRole) : false;
    */
  };

  // Utility methods
  const clearError = () => {
    setError(null);
  };

  const refreshUser = async () => {
    // Mock implementation - silent in development mode
    // TODO: Implement user refresh functionality
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