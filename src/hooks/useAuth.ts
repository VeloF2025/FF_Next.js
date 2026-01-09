/**
 * Authentication Hook
 * Provides user authentication state and methods
 * Migrated from Firebase to Clerk with development bypass
 */

import { useState, useEffect } from 'react';
import { authConfig } from '@/config/auth.config';
import { log } from '@/lib/logger';

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  photoURL?: string | null;
  role?: string;
  permissions?: string[];
}

interface UseAuthResult {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
}

export function useAuth(): UseAuthResult {
  const [error, setError] = useState<string | null>(null);
  
  // Development mode bypass
  if (authConfig.isDevMode) {
    log.info('🔧 DEV MODE: Authentication bypassed', {}, 'useAuth');
    return {
      user: {
        id: authConfig.devUser.id,
        email: authConfig.devUser.email,
        name: authConfig.devUser.name,
        photoURL: authConfig.devUser.photoURL,
        role: authConfig.devUser.role,
        permissions: ['*']
      },
      isLoading: false,
      isAuthenticated: true,
      error: null
    };
  }

  // Production mode - use Clerk
  const { isLoaded, isSignedIn, userId } = useClerkAuth();
  const { user: clerkUser } = useUser();

  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (!isLoaded) return;

    if (isSignedIn && clerkUser) {
      setUser({
        id: userId!,
        email: clerkUser.primaryEmailAddress?.emailAddress || null,
        name: clerkUser.fullName || clerkUser.firstName || null,
        photoURL: clerkUser.imageUrl || null,
        role: (clerkUser.publicMetadata?.role as string) || 'viewer',
        permissions: (clerkUser.publicMetadata?.permissions as string[]) || []
      });
      setError(null);
      log.info('User authenticated', { userId }, 'useAuth');
    } else {
      setUser(null);
      log.info('User not authenticated', {}, 'useAuth');
    }
  }, [isLoaded, isSignedIn, userId, clerkUser]);

  return {
    user,
    isLoading: !isLoaded,
    isAuthenticated: !!user || (authConfig.isDevMode && authConfig.features.autoLogin),
    error
  };
}