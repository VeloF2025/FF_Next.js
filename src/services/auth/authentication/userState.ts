/**
 * User State Management
 * User state and profile management methods (mock implementation)
 */

import { clerkAuth } from '../mockAuth';
import { authConfig } from '@/config/auth.config';
import { User } from '@/types/auth.types';
import { getUserProfile, getUserFromFirestore } from '../userService';
import { AuthUser } from '../authHelpers';

// Mock AuthUser for dev mode compatibility
const createMockAuthUser = (user: User): AuthUser => ({
  uid: user.id,
  email: user.email,
  displayName: user.displayName,
  photoURL: user.photoURL,
  emailVerified: true,
});

export class UserState {
  /**
   * Sign out
   */
  async signOut(): Promise<void> {
    if (authConfig.isDevMode) {
      console.log('🔧 DEV MODE: Mock sign out');
      return;
    }

    await clerkAuth.signOut();
  }

  /**
   * Get current user (legacy method)
   */
  getCurrentUser(): AuthUser | null {
    if (authConfig.isDevMode) {
      const mockUser = authConfig.devUser;
      return createMockAuthUser(mockUser);
    }

    try {
      // In Clerk context, we need to get the user synchronously
      // This is a simplified approach - use useAuth/useUser hooks in React components
      const currentUser = this.getCurrentUserSync();
      return currentUser ? createMockAuthUser(currentUser) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get current user (enhanced method)
   */
  async getCurrentUserEnhanced(): Promise<User | null> {
    if (authConfig.isDevMode) {
      console.log('🔧 DEV MODE: Returning mock user (enhanced)');
      return authConfig.devUser;
    }

    try {
      const clerkUser = await clerkAuth.getCurrentUser();
      if (!clerkUser) {
        return null;
      }

      try {
        // Try to get from storage first (Firestore or Neon DB)
        const storedUser = await getUserFromFirestore(clerkUser.id);
        if (storedUser) {
          return storedUser;
        }

        // If not in storage, create/get profile
        return await getUserProfile(clerkUser);
      } catch (error) {
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    if (authConfig.isDevMode) {
      return true;
    }

    return clerkAuth.isAuthenticated();
  }

  /**
   * Wait for auth to be ready
   */
  async waitForAuth(): Promise<User | null> {
    if (authConfig.isDevMode) {
      return authConfig.devUser;
    }

    try {
      // In Clerk, we need to wait for the auth state to be loaded
      const isReady = await clerkAuth.checkAuthStatus();
      if (isReady) {
        return await clerkAuth.getCurrentUser();
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Update user profile
   */
  async updateUserProfile(updates: { displayName?: string; photoURL?: string }): Promise<void> {
    if (authConfig.isDevMode) {
      console.log('🔧 DEV MODE: Mock profile update:', updates);
      return;
    }

    const currentUser = await clerkAuth.getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user');
    }

    // Update Clerk profile
    await clerkAuth.updateUserProfile({
      name: updates.displayName,
      photoURL: updates.photoURL,
    });
  }

  /**
   * Send email verification
   */
  async sendEmailVerification(): Promise<void> {
    if (authConfig.isDevMode) {
      console.log('🔧 DEV MODE: Mock email verification sent');
      return;
    }

    const currentUser = await clerkAuth.getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user');
    }

    // In Clerk, email verification is handled differently
    // This would typically be handled by Clerk's built-in verification flow
    throw new Error('Email verification should be handled through Clerk\'s verification flow');
  }

  /**
   * Helper method to get current user synchronously
   * Note: Use React hooks in components instead
   */
  private getCurrentUserSync(): User | null {
    try {
      // This is a fallback for non-React contexts
      // In React components, use useAuth() and useUser() hooks directly
      return null;
    } catch (error) {
      return null;
    }
  }
}