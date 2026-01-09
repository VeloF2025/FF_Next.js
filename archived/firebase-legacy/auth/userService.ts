import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { db } from '@/config/firebase'; // Keep Firestore for data storage
import { clerkAuth } from './clerkAuth';
import { authConfig } from '@/config/auth.config';
import { handleAuthError } from './authHelpers';
import {
  User,
  UserRole,
  Permission,
  ChangePasswordRequest,
  ROLE_PERMISSIONS,
} from '@/types/auth.types';
import { handleAuthError } from './authHelpers';

/**
 * Creates a new user profile in Firestore using Clerk user data
 */
export async function createUserProfile(
  clerkUser: User | { id: string; email: string; displayName?: string | null; photoURL?: string | null },
  additionalData?: Partial<User>
): Promise<User> {
  if (authConfig.isDevMode) {
    console.log('🔧 DEV MODE: Creating mock user profile:', clerkUser.email);
    return {
      ...authConfig.devUser,
      ...additionalData,
    };
  }

  const userDoc = doc(db, 'users', clerkUser.id);
  
  // Check if user already exists
  const userSnapshot = await getDoc(userDoc);
  if (userSnapshot.exists()) {
    return userSnapshot.data() as User;
  }

  // Create new user profile
  const newUser: User = {
    id: clerkUser.id,
    email: clerkUser.email || '',
    displayName: clerkUser.displayName || additionalData?.displayName || '',
    photoURL: clerkUser.photoURL || null,
    role: UserRole.VIEWER,
    permissions: ROLE_PERMISSIONS[UserRole.VIEWER],
    isEmailVerified: true, // Clerk handles email verification
    lastLoginAt: new Date(),
    createdAt: new Date(),
    ...additionalData,
  };

  await setDoc(userDoc, newUser);
  return newUser;
}

/**
 * Gets user profile from Firestore using Clerk user data
 */
export async function getUserProfile(clerkUser: User | { id: string; email: string; displayName?: string | null; photoURL?: string | null }): Promise<User> {
  if (authConfig.isDevMode) {
    console.log('🔧 DEV MODE: Getting mock user profile for:', clerkUser.email);
    return authConfig.devUser;
  }

  const userDoc = doc(db, 'users', clerkUser.id);
  const userSnapshot = await getDoc(userDoc);

  if (userSnapshot.exists()) {
    const userData = userSnapshot.data() as User;
    // Update Clerk auth fields in case they changed
    if (
      userData.email !== clerkUser.email ||
      userData.displayName !== clerkUser.displayName ||
      userData.photoURL !== clerkUser.photoURL
    ) {
      const updates = {
        email: clerkUser.email,
        displayName: clerkUser.displayName,
        photoURL: clerkUser.photoURL,
        isEmailVerified: true, // Clerk handles verification
      };
      await updateDoc(userDoc, updates);
      return { 
        ...userData, 
        ...updates,
        email: updates.email || userData.email || '',
        displayName: updates.displayName || userData.displayName || '',
        photoURL: updates.photoURL !== undefined ? updates.photoURL : userData.photoURL
      };
    }
    return userData;
  }

  // User doesn't exist in Firestore, create profile
  return createUserProfile(clerkUser);
}

/**
 * Gets user from Firestore by ID
 */
export async function getUserFromFirestore(userId: string): Promise<User | null> {
  if (authConfig.isDevMode) {
    console.log('🔧 DEV MODE: Getting mock user from storage:', userId);
    return authConfig.devUser.id === userId ? authConfig.devUser : null;
  }

  try {
    const userDoc = doc(db, 'users', userId);
    const userSnapshot = await getDoc(userDoc);
    
    if (userSnapshot.exists()) {
      return userSnapshot.data() as User;
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Updates user's last login timestamp
 */
export async function updateLastLogin(userId: string): Promise<void> {
  if (authConfig.isDevMode) {
    console.log('🔧 DEV MODE: Mock updating last login for user:', userId);
    return;
  }

  try {
    const userDoc = doc(db, 'users', userId);
    await updateDoc(userDoc, {
      'metadata.lastLoginAt': serverTimestamp(),
      'metadata.lastActivityAt': serverTimestamp(),
    });
  } catch (error) {
    // Silent fail for analytics update
  }
}

/**
 * Updates user profile information
 */
export async function updateUserProfile(
  userId: string,
  updates: Partial<User>
): Promise<User> {
  if (authConfig.isDevMode) {
    console.log('🔧 DEV MODE: Mock updating user profile:', userId, updates);
    return { ...authConfig.devUser, ...updates };
  }

  try {
    const userDoc = doc(db, 'users', userId);
    
    // Remove undefined values
    const cleanUpdates = Object.entries(updates).reduce((acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] = value;
      }
      return acc;
    }, {} as Record<string, unknown>);

    // Add updated timestamp
    cleanUpdates['metadata.updatedAt'] = serverTimestamp();
    cleanUpdates['metadata.lastActivityAt'] = serverTimestamp();

    // Update Firestore document
    await updateDoc(userDoc, cleanUpdates);

    // If display name or photo changed, update Clerk profile
    if (updates.displayName !== undefined || updates.photoURL !== undefined) {
      await clerkAuth.updateUserProfile({
        name: updates.displayName,
        photoURL: updates.photoURL,
      });
    }

    // Fetch and return updated user
    const updatedSnapshot = await getDoc(userDoc);
    return updatedSnapshot.data() as User;
  } catch (error) {
    throw handleAuthError(error);
  }
}

/**
 * Gets user by email address
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  if (authConfig.isDevMode) {
    console.log('🔧 DEV MODE: Getting mock user by email:', email);
    return authConfig.devUser.email === email ? authConfig.devUser : null;
  }

  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', email));
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      return querySnapshot.docs[0].data() as User;
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Changes user's password
 */
export async function changeUserPassword(request: ChangePasswordRequest): Promise<void> {
  if (authConfig.isDevMode) {
    console.log('🔧 DEV MODE: Mock password change for current user');
    return;
  }

  try {
    const currentUser = await clerkAuth.getCurrentUser();
    if (!currentUser || !currentUser.email) {
      throw new Error('No authenticated user found');
    }

    // In Clerk, password changes are handled through the user profile UI
    // This would typically redirect to Clerk's password change flow
    throw new Error('Password changes should be handled through Clerk\'s user profile interface');
  } catch (error) {
    throw handleAuthError(error);
  }
}

/**
 * Sends email verification to current user
 */
export async function sendUserEmailVerification(): Promise<void> {
  if (authConfig.isDevMode) {
    console.log('🔧 DEV MODE: Mock email verification sent');
    return;
  }

  const currentUser = await clerkAuth.getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // In Clerk, email verification is handled automatically during sign-up
  // or through Clerk's user profile interface
  throw new Error('Email verification is handled automatically by Clerk during sign-up');
}

/**
 * Checks if a user has a specific permission
 */
export function hasPermission(user: User, permission: Permission): boolean {
  return user.permissions.includes(permission);
}

/**
 * Checks if a user has any of the specified permissions
 */
export function hasAnyPermission(user: User, permissions: Permission[]): boolean {
  return permissions.some(permission => hasPermission(user, permission));
}

/**
 * Checks if a user has all of the specified permissions
 */
export function hasAllPermissions(user: User, permissions: Permission[]): boolean {
  return permissions.every(permission => hasPermission(user, permission));
}