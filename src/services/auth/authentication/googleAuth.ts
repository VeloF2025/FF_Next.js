/**
 * Google Authentication
 * Google OAuth authentication methods (mock implementation)
 */

import { clerkAuth } from '../mockAuth';
import { authConfig } from '@/config/auth.config';
import { User } from '@/types/auth.types';
import { getUserProfile, updateLastLogin } from '../userService';
import { AuthUser, handleAuthError } from '../authHelpers';
import { log } from '@/lib/logger';

// Mock AuthUser for dev mode compatibility
const createMockAuthUser = (user: { id: string; email: string; displayName?: string | null; name?: string; photoURL?: string | null }): AuthUser => ({
  uid: user.id,
  email: user.email,
  displayName: user.displayName ?? user.name ?? null,
  photoURL: user.photoURL ?? null,
  emailVerified: true,
});

export class GoogleAuthentication {
  constructor() {
    // No setup needed for Clerk - handled by ClerkProvider
  }

  /**
   * Sign in with Google (legacy method)
   */
  async signInWithGoogle(): Promise<AuthUser> {
    if (authConfig.isDevMode) {
      log.debug('googleAuth', { message: 'DEV MODE: Mock Google sign in' });
      const mockUser = authConfig.devUser;
      await updateLastLogin(mockUser.id);
      return createMockAuthUser(mockUser);
    }

    try {
      // In Clerk, Google sign-in is handled by UI components
      // This method should not be called directly in production
      const user = await clerkAuth.signInWithGoogle();
      await updateLastLogin(user.id);
      return createMockAuthUser(user);
    } catch (error: unknown) {
      throw handleAuthError(error);
    }
  }

  /**
   * Sign in with Google (enhanced method)
   */
  async signInWithGoogleEnhanced(_rememberMe = false): Promise<User> {
    if (authConfig.isDevMode) {
      log.debug('googleAuth', { message: 'DEV MODE: Mock Google sign in (enhanced)' });
      const user = authConfig.devUser;
      await updateLastLogin(user.id);
      return user as unknown as User;
    }

    try {
      // In Clerk, persistence is handled automatically
      // This method redirects to Clerk's OAuth flow
      const user = await clerkAuth.signInWithGoogle();

      // Get or create user profile
      const userProfile = await getUserProfile(user);

      // Update last login
      await updateLastLogin(user.id);

      return userProfile;
    } catch (error: unknown) {
      throw handleAuthError(error);
    }
  }
}