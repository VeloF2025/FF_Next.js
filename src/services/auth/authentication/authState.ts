/**
 * Authentication State
 * Authentication state listeners and change handlers (mock implementation)
 */

import { authConfig } from '@/config/auth.config';
import { User } from '@/types/auth.types';
import { getUserProfile } from '../userService';
import { AuthUser } from '../authHelpers';
import { log } from '@/lib/logger';

// Mock AuthUser for dev mode compatibility
const createMockAuthUser = (user: User): AuthUser => ({
  uid: user.id,
  email: user.email,
  displayName: user.displayName,
  photoURL: user.photoURL,
  emailVerified: true,
});

export class AuthState {
  private authStateListeners: Set<(user: AuthUser | null) => void> = new Set();
  private enhancedAuthStateListeners: Set<(user: User | null) => void> = new Set();

  /**
   * Subscribe to auth state changes (legacy method)
   */
  onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void {
    if (authConfig.isDevMode) {
      log.debug('authState', { message: 'DEV MODE: Setting up mock auth state listener' });
      // In dev mode, immediately call callback with mock user
      setTimeout(() => {
        const mockUser = authConfig.devUser;
        callback(createMockAuthUser(mockUser));
      }, 100);

      // Return cleanup function
      return () => {
        this.authStateListeners.delete(callback);
      };
    }

    this.authStateListeners.add(callback);

    // In Clerk, we need to listen to auth changes differently
    // This is a simplified approach - in practice, you'd use React hooks
    const checkAuthState = async () => {
      try {
        const user = await this.getCurrentClerkUser();
        if (user) {
          callback(createMockAuthUser(user));
        } else {
          callback(null);
        }
      } catch (error) {
        callback(null);
      }
    };

    // Initial check
    checkAuthState();

    // Return cleanup function
    return () => {
      this.authStateListeners.delete(callback);
    };
  }

  /**
   * Subscribe to auth state changes (enhanced)
   */
  onAuthStateChangedEnhanced(callback: (user: User | null) => void): () => void {
    if (authConfig.isDevMode) {
      log.debug('authState', { message: 'DEV MODE: Setting up mock enhanced auth state listener' });
      // In dev mode, immediately call callback with mock user
      setTimeout(() => {
        callback(authConfig.devUser);
      }, 100);

      // Return cleanup function
      return () => {
        this.enhancedAuthStateListeners.delete(callback);
      };
    }

    this.enhancedAuthStateListeners.add(callback);

    // In Clerk, auth state changes are handled by React hooks
    const checkAuthState = async () => {
      try {
        const clerkUser = await this.getCurrentClerkUser();
        if (clerkUser) {
          try {
            const user = await getUserProfile(clerkUser);
            callback(user);
          } catch (error) {
            callback(null);
          }
        } else {
          callback(null);
        }
      } catch (error) {
        callback(null);
      }
    };

    // Initial check
    checkAuthState();

    // Return cleanup function
    return () => {
      this.enhancedAuthStateListeners.delete(callback);
    };
  }

  /**
   * Helper method to get current Clerk user
   * Note: In React components, use useAuth() and useUser() hooks directly
   */
  private async getCurrentClerkUser(): Promise<User | null> {
    // This method is a fallback for non-React contexts
    // In practice, Clerk auth state should be managed through React hooks
    try {
      // Check if we're in a React context where hooks are available
      if (typeof window !== 'undefined') {
        // Return null to indicate that hooks should be used instead
        return null;
      }
      return null;
    } catch (error) {
      return null;
    }
  }
}