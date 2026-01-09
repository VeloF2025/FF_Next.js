
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'technician' | 'viewer';
  photoURL?: string;
  createdAt: Date;
}

const isDevelopment = process.env.NODE_ENV === 'development';
const DEV_MODE_ENABLED = process.env.NEXT_PUBLIC_DEV_MODE !== 'false';

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
    return isDevelopment && DEV_MODE_ENABLED;
  }

  async getCurrentUser(): Promise<User | null> {
    if (this.isDevMode()) {
      console.log('🔧 DEV MODE: Returning mock user');
      return mockUser;
    }

    try {
      const { userId, sessionId, getToken } = useClerkAuth();
      const { user } = useUser();
      
      if (!userId || !user) {
        return null;
      }

      return {
        id: userId,
        email: user.primaryEmailAddress?.emailAddress || '',
        name: user.fullName || user.firstName || 'User',
        role: (user.publicMetadata?.role as User['role']) || 'viewer',
        photoURL: user.imageUrl,
        createdAt: new Date(user.createdAt)
      };
    } catch (error) {
      console.error('Error getting current user:', error);
      if (this.isDevMode()) {
        return mockUser;
      }
      return null;
    }
  }

  async signInWithEmailAndPassword(email: string, password: string): Promise<User> {
    if (this.isDevMode()) {
      console.log('🔧 DEV MODE: Mock sign in with email:', email);
      return { ...mockUser, email, name: email.split('@')[0] };
    }

    throw new Error('Email/password sign in should be handled by Clerk components');
  }

  async signInWithGoogle(): Promise<User> {
    if (this.isDevMode()) {
      console.log('🔧 DEV MODE: Mock Google sign in');
      return mockUser;
    }

    throw new Error('Google sign in should be handled by Clerk components');
  }

  async signOut(): Promise<void> {
    if (this.isDevMode()) {
      console.log('🔧 DEV MODE: Mock sign out');
      return;
    }

    const { signOut } = useClerkAuth();
    await signOut();
  }

  async createUserWithEmailAndPassword(email: string, password: string, displayName?: string): Promise<User> {
    if (this.isDevMode()) {
      console.log('🔧 DEV MODE: Mock user creation:', email);
      return {
        ...mockUser,
        id: `dev-user-${Date.now()}`,
        email,
        name: displayName || email.split('@')[0]
      };
    }

    throw new Error('User creation should be handled by Clerk components');
  }

  async updateUserProfile(updates: Partial<User>): Promise<void> {
    if (this.isDevMode()) {
      console.log('🔧 DEV MODE: Mock profile update:', updates);
      return;
    }

    const { user } = useUser();
    if (!user) throw new Error('No user logged in');

    await user.update({
      firstName: updates.name,
      publicMetadata: {
        role: updates.role
      }
    });
  }

  isAuthenticated(): boolean {
    if (this.isDevMode()) {
      return true;
    }

    const { isSignedIn } = useClerkAuth();
    return isSignedIn || false;
  }

  async checkAuthStatus(): Promise<boolean> {
    if (this.isDevMode()) {
      return true;
    }

    const { isLoaded, isSignedIn } = useClerkAuth();
    if (!isLoaded) {
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.checkAuthStatus();
    }
    return isSignedIn || false;
  }

  getUserRole(): User['role'] {
    if (this.isDevMode()) {
      return 'admin';
    }

    const { user } = useUser();
    return (user?.publicMetadata?.role as User['role']) || 'viewer';
  }

  hasPermission(requiredRole: User['role']): boolean {
    if (this.isDevMode()) {
      return true;
    }

    const roleHierarchy: Record<User['role'], number> = {
      admin: 4,
      manager: 3,
      technician: 2,
      viewer: 1
    };

    const userRole = this.getUserRole();
    return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
  }
}

export const clerkAuth = ClerkAuthService.getInstance();

export const useAuthState = () => {
  if (isDevelopment && DEV_MODE_ENABLED) {
    return {
      user: mockUser,
      isLoading: false,
      isAuthenticated: true,
      error: null
    };
  }

  const { isLoaded, isSignedIn, userId } = useClerkAuth();
  const { user } = useUser();

  return {
    user: user ? {
      id: userId!,
      email: user.primaryEmailAddress?.emailAddress || '',
      name: user.fullName || user.firstName || 'User',
      role: (user.publicMetadata?.role as User['role']) || 'viewer',
      photoURL: user.imageUrl,
      createdAt: new Date(user.createdAt)
    } : null,
    isLoading: !isLoaded,
    isAuthenticated: isSignedIn || false,
    error: null
  };
};