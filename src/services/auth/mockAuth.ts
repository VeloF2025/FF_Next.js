/**
 * Auth Service - Mock Implementation
 *
 * This is a mock-only auth service used during development.
 * Authentication system was removed in commit 1400838b.
 * See CLEAN_FOUNDATION.md for details.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'technician' | 'viewer';
  photoURL?: string;
  createdAt: Date;
}

export const mockUser: User = {
  id: 'dev-user-001',
  email: 'dev@fibreflow.local',
  name: 'Development Admin',
  role: 'admin',
  photoURL: 'https://ui-avatars.com/api/?name=Dev+Admin&background=0D8ABC&color=fff',
  createdAt: new Date()
};

export class ClerkAuthService {
  private static instance: ClerkAuthService;

  private constructor() {}

  static getInstance(): ClerkAuthService {
    if (!ClerkAuthService.instance) {
      ClerkAuthService.instance = new ClerkAuthService();
    }
    return ClerkAuthService.instance;
  }

  isDevMode(): boolean {
    // Always return true - no auth system configured
    return true;
  }

  async getCurrentUser(): Promise<User | null> {
    return mockUser;
  }

  async signInWithEmailAndPassword(email: string, _password: string): Promise<User> {
    return { ...mockUser, email, name: email.split('@')[0] ?? email };
  }

  async signInWithGoogle(): Promise<User> {
    return mockUser;
  }

  async signOut(): Promise<void> {
    // No-op - no auth system
  }

  async createUserWithEmailAndPassword(email: string, password: string, displayName?: string): Promise<User> {
    return {
      ...mockUser,
      id: `dev-user-${Date.now()}`,
      email,
      name: displayName || email.split('@')[0] || email
    };
  }

  async updateUserProfile(_updates: Partial<User>): Promise<void> {
    // No-op - no auth system
  }

  isAuthenticated(): boolean {
    return true;
  }

  async checkAuthStatus(): Promise<boolean> {
    return true;
  }

  getUserRole(): User['role'] {
    return 'admin';
  }

  hasPermission(_requiredRole: User['role']): boolean {
    return true;
  }
}

export const clerkAuth = ClerkAuthService.getInstance();

export const useAuthState = () => {
  return {
    user: mockUser,
    isLoading: false,
    isAuthenticated: true,
    error: null
  };
};