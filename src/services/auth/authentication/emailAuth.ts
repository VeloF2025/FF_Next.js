/**
 * Email Authentication
 * Mock implementation for development mode
 */

import { clerkAuth, User as ClerkUser } from '../mockAuth';
import { authConfig } from '@/config/auth.config';
import { LoginCredentials, RegisterCredentials, PasswordResetRequest, User } from '@/types/auth.types';
import { createUserProfile, getUserProfile, updateLastLogin } from '../userService';
import { AuthUser } from '../authHelpers';

export class EmailAuthentication {
  /**
   * Sign in with email and password (legacy method)
   */
  async signInWithEmail(email: string, password: string): Promise<AuthUser> {
    if (authConfig.isDevMode) {
      console.log('🔧 DEV MODE: Mock email sign in:', email);
      const mockUser = await clerkAuth.signInWithEmailAndPassword(email, password);
      return {
        id: mockUser.id,
        email: mockUser.email,
        displayName: mockUser.name,
        photoURL: mockUser.photoURL
      };
    }

    const user = await clerkAuth.signInWithEmailAndPassword(email, password);
    await updateLastLogin(user.id);
    return {
      id: user.id,
      email: user.email,
      displayName: user.name,
      photoURL: user.photoURL
    };
  }

  /**
   * Sign in with email and password (enhanced method)
   */
  async signInWithEmailEnhanced(credentials: LoginCredentials): Promise<User> {
    try {
      if (authConfig.isDevMode) {
        console.log('🔧 DEV MODE: Mock enhanced email sign in:', credentials.email);
        const mockUser = await clerkAuth.signInWithEmailAndPassword(credentials.email, credentials.password);
        return {
          uid: mockUser.id,
          email: mockUser.email || '',
          displayName: mockUser.name || '',
          photoURL: mockUser.photoURL || '',
          role: mockUser.role || 'viewer',
          emailVerified: true,
          createdAt: mockUser.createdAt.toISOString(),
          lastLoginAt: new Date().toISOString()
        } as User;
      }

      const clerkUser = await clerkAuth.signInWithEmailAndPassword(
        credentials.email,
        credentials.password
      );

      // Update last login time
      await updateLastLogin(clerkUser.id);

      // Get user profile from database
      const user = await getUserProfile({ uid: clerkUser.id } as any);
      return user;
    } catch (error: unknown) {
      console.error('Email sign in error:', error);
      throw error;
    }
  }

  /**
   * Sign up with email and password (legacy method)
   */
  async signUp(email: string, password: string, displayName?: string): Promise<AuthUser> {
    if (authConfig.isDevMode) {
      console.log('🔧 DEV MODE: Mock email sign up:', email);
      const mockUser = await clerkAuth.createUserWithEmailAndPassword(email, password, displayName);
      return {
        id: mockUser.id,
        email: mockUser.email,
        displayName: mockUser.name,
        photoURL: mockUser.photoURL
      };
    }

    const user = await clerkAuth.createUserWithEmailAndPassword(email, password, displayName);
    return {
      id: user.id,
      email: user.email,
      displayName: user.name,
      photoURL: user.photoURL
    };
  }

  /**
   * Register with email and password (enhanced method)
   */
  async registerWithEmail(credentials: RegisterCredentials): Promise<User> {
    try {
      if (authConfig.isDevMode) {
        console.log('🔧 DEV MODE: Mock registration:', credentials.email);
        const displayName = `${credentials.firstName} ${credentials.lastName}`.trim();
        const mockUser = await clerkAuth.createUserWithEmailAndPassword(
          credentials.email,
          credentials.password,
          displayName
        );
        return {
          uid: mockUser.id,
          email: mockUser.email || '',
          displayName: mockUser.name || '',
          photoURL: mockUser.photoURL || '',
          role: mockUser.role || 'viewer',
          emailVerified: true,
          createdAt: mockUser.createdAt.toISOString(),
          lastLoginAt: new Date().toISOString()
        } as User;
      }

      const displayName = `${credentials.firstName} ${credentials.lastName}`.trim();
      const clerkUser = await clerkAuth.createUserWithEmailAndPassword(
        credentials.email,
        credentials.password,
        displayName
      );

      // Create user profile in database
      const user = await createUserProfile({ uid: clerkUser.id } as any, {
        displayName,
      });

      return user;
    } catch (error: unknown) {
      console.error('Registration error:', error);
      throw error;
    }
  }

  /**
   * Reset password (legacy method)
   */
  async resetPassword(email: string): Promise<void> {
    if (authConfig.isDevMode) {
      console.log('🔧 DEV MODE: Mock password reset for:', email);
      return;
    }
    
    // In production, Clerk handles password reset through their UI
    console.log('Password reset requested for:', email);
    console.log('Clerk will handle this through their hosted UI');
  }

  /**
   * Reset password (enhanced method)
   */
  async resetPasswordEnhanced(request: PasswordResetRequest): Promise<void> {
    if (authConfig.isDevMode) {
      console.log('🔧 DEV MODE: Mock password reset for:', request.email);
      return;
    }

    // In production, Clerk handles password reset through their UI
    console.log('Password reset requested for:', request.email);
    console.log('Clerk will handle this through their hosted UI');
  }

  /**
   * Change user password
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    if (authConfig.isDevMode) {
      console.log('🔧 DEV MODE: Mock password change');
      return;
    }

    // In production, Clerk handles password changes through their UI
    console.log('Password change requested');
    console.log('Clerk will handle this through their user profile UI');
  }
}