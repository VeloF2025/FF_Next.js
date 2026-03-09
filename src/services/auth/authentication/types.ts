/**
 * Authentication Module Types
 * Interface definitions for the modular authentication system
 */

import { User, LoginCredentials, RegisterCredentials, PasswordResetRequest } from '@/types/auth.types';
import { AuthUser } from '../authHelpers';

/** Email/password and credential-based auth methods */
export interface AuthenticationMethods {
  signInWithEmail(email: string, password: string): Promise<AuthUser>;
  signInWithEmailEnhanced(credentials: LoginCredentials): Promise<User>;
  signUp(email: string, password: string, displayName?: string): Promise<AuthUser>;
  registerWithEmail(credentials: RegisterCredentials): Promise<User>;
  resetPassword(email: string): Promise<void>;
  resetPasswordEnhanced(request: PasswordResetRequest): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  signInWithGoogle(): Promise<AuthUser>;
  signInWithGoogleEnhanced(rememberMe?: boolean): Promise<User>;
}

/** User state and profile management methods */
export interface UserMethods {
  signOut(): Promise<void>;
  getCurrentUser(): AuthUser | null;
  getCurrentUserEnhanced(): Promise<User | null>;
  isAuthenticated(): boolean;
  waitForAuth(): Promise<User | null>;
  updateUserProfile(updates: { displayName?: string; photoURL?: string }): Promise<void>;
  sendEmailVerification(): Promise<void>;
}

/** Auth state listener methods */
export interface AuthStateMethods {
  onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void;
  onAuthStateChangedEnhanced(callback: (user: User | null) => void): () => void;
}

/** Permission and role checking methods */
export interface PermissionMethods {
  hasPermission(permission: string): boolean;
  hasAnyPermission(permissions: string[]): boolean;
  hasAllPermissions(permissions: string[]): boolean;
  hasRole(role: string): boolean;
  hasAnyRole(roles: string[]): boolean;
}
