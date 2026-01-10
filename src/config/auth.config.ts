export const authConfig = {
  isDevelopment: process.env.NODE_ENV === 'development',
  devModeEnabled: process.env.NEXT_PUBLIC_DEV_MODE !== 'false',
  
  get isDevMode() {
    return this.isDevelopment && this.devModeEnabled;
  },

  devUser: {
    id: 'dev-user-001',
    email: 'dev@fibreflow.local',
    name: 'Development Admin',
    role: 'admin' as const,
    photoURL: 'https://ui-avatars.com/api/?name=Dev+Admin&background=0D8ABC&color=fff',
    createdAt: new Date()
  },

  features: {
    requireAuth: false,
    showDevBanner: true,
    autoLogin: true,
    bypassPermissions: true
  },

  messages: {
    devMode: '🔧 Development Mode - Authentication Bypassed',
    notAuthenticated: 'Please sign in to continue',
    unauthorized: 'You do not have permission to access this resource'
  },

  roleHierarchy: {
    admin: 4,
    manager: 3,
    technician: 2,
    viewer: 1
  } as const,

  defaultRole: 'viewer' as const,

  sessionConfig: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    updateAge: 24 * 60 * 60 * 1000
  }
};

export type AuthRole = 'admin' | 'manager' | 'technician' | 'viewer';

export const checkPermission = (userRole: AuthRole, requiredRole: AuthRole): boolean => {
  if (authConfig.isDevMode && authConfig.features.bypassPermissions) {
    return true;
  }
  
  return authConfig.roleHierarchy[userRole] >= authConfig.roleHierarchy[requiredRole];
};

export const getAuthMode = (): 'development' | 'production' => {
  return authConfig.isDevMode ? 'development' : 'production';
};

export const shouldShowAuthUI = (): boolean => {
  return !authConfig.isDevMode || !authConfig.features.autoLogin;
};

export const getAuthMessage = (type: 'devMode' | 'notAuthenticated' | 'unauthorized'): string => {
  return authConfig.messages[type];
};