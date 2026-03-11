/**
 * Auth Helpers
 * Helper types and functions for the authentication service
 */

import { User } from '@/types/auth.types';

/** Simplified auth user representation used by legacy auth modules */
export interface AuthUser {
  uid?: string;
  id?: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  emailVerified?: boolean;
}

/**
 * Map a Firebase-like user to our User type
 */
export function mapFirebaseUser(firebaseUser: AuthUser): Partial<User> {
  return {
    id: firebaseUser.uid || firebaseUser.id || '',
    email: firebaseUser.email,
    displayName: firebaseUser.displayName,
    photoURL: firebaseUser.photoURL,
  };
}

/**
 * Handle auth errors and convert to a consistent format
 */
export function handleAuthError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
