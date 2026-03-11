/**
 * User Service
 * User profile management — mock implementation for development mode
 */

import { User } from '@/types/auth.types';
import { authConfig } from '@/config/auth.config';
import { log } from '@/lib/logger';

/** Default mock user matching the auth.types.User interface */
function getDefaultUser(overrides: Partial<User> = {}): User {
  return {
    id: 'dev-user-001',
    email: 'dev@fibreflow.local',
    displayName: 'Development Admin',
    photoURL: null,
    role: authConfig.defaultRole as unknown as User['role'],
    permissions: [],
    isEmailVerified: true,
    lastLoginAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a user profile in the database
 */
export async function createUserProfile(
  authUser: { uid: string } | Record<string, unknown>,
  options?: { displayName?: string }
): Promise<User> {
  const uid = 'uid' in authUser ? (authUser as { uid: string }).uid : String(authUser.id || '');
  log.debug('Creating user profile (mock)', { uid }, 'userService');
  return getDefaultUser({
    id: uid,
    displayName: options?.displayName || null,
  });
}

/**
 * Get a user profile from the database
 */
export async function getUserProfile(
  authUser: { uid?: string; id?: string; email?: string } | Record<string, unknown>
): Promise<User> {
  const uid = (authUser as Record<string, unknown>).uid || (authUser as Record<string, unknown>).id || '';
  log.debug('Getting user profile (mock)', { uid: String(uid) }, 'userService');
  return getDefaultUser({ id: String(uid) });
}

/**
 * Get user from Firestore (legacy) — returns mock user
 */
export async function getUserFromFirestore(userId: string): Promise<User | null> {
  log.debug('Getting user from Firestore (mock)', { userId }, 'userService');
  return getDefaultUser({ id: userId });
}

/**
 * Update last login timestamp
 */
export async function updateLastLogin(userId: string): Promise<void> {
  log.debug('Updating last login (mock)', { userId }, 'userService');
}

/**
 * Update user profile
 */
export async function updateUserProfile(
  userId: string,
  updates: Partial<User>
): Promise<User> {
  log.debug('Updating user profile (mock)', { userId }, 'userService');
  return getDefaultUser({ id: userId, ...updates });
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  log.debug('Getting user by email (mock)', { email }, 'userService');
  return getDefaultUser({ email });
}

/**
 * Change user password
 */
export async function changeUserPassword(
  _userId: string,
  _currentPassword: string,
  _newPassword: string
): Promise<void> {
  log.debug('Changing password (mock)', {}, 'userService');
}

/**
 * Send email verification
 */
export async function sendUserEmailVerification(_userId: string): Promise<void> {
  log.debug('Sending email verification (mock)', {}, 'userService');
}

/**
 * Check if user has a specific permission
 */
export function hasPermission(_permission: string): boolean {
  return true;
}

/**
 * Check if user has any of the given permissions
 */
export function hasAnyPermission(permissions: string[]): boolean {
  return permissions.length > 0;
}

/**
 * Check if user has all of the given permissions
 */
export function hasAllPermissions(_permissions: string[]): boolean {
  return true;
}
