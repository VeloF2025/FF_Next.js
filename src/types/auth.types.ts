/** Minimal representation of an authenticated session user (replaces firebase/auth User) */
export interface FirebaseUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  role: UserRole;
  permissions: Permission[];
  isEmailVerified: boolean;
  lastLoginAt: Date;
  createdAt: Date;
  profile?: UserProfile;
}

export interface UserProfile {
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  department?: string;
  position?: string;
  preferences?: UserPreferences;
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'vf' | 'fibreflow';
  language: string;
  timezone: string;
  emailNotifications: boolean;
  pushNotifications: boolean;
}

export enum UserRole {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  PROJECT_MANAGER = 'project_manager',
  SITE_SUPERVISOR = 'site_supervisor',
  FIELD_TECHNICIAN = 'field_technician',
  CONTRACTOR = 'contractor',
  CLIENT = 'client',
  VIEWER = 'viewer'
}

export enum Permission {
  // Project Management
  PROJECTS_CREATE = 'projects.create',
  PROJECTS_READ = 'projects.read',
  PROJECTS_UPDATE = 'projects.update',
  PROJECTS_DELETE = 'projects.delete',
  PROJECTS_ASSIGN = 'projects.assign',
  
  // Staff Management
  STAFF_CREATE = 'staff.create',
  STAFF_READ = 'staff.read',
  STAFF_UPDATE = 'staff.update',
  STAFF_DELETE = 'staff.delete',
  STAFF_ASSIGN = 'staff.assign',
  
  // Client Management
  CLIENTS_CREATE = 'clients.create',
  CLIENTS_READ = 'clients.read',
  CLIENTS_UPDATE = 'clients.update',
  CLIENTS_DELETE = 'clients.delete',
  
  // Pole Tracker
  POLES_CREATE = 'poles.create',
  POLES_READ = 'poles.read',
  POLES_UPDATE = 'poles.update',
  POLES_DELETE = 'poles.delete',
  POLES_ASSIGN = 'poles.assign',
  
  // Stock Management
  STOCK_CREATE = 'stock.create',
  STOCK_READ = 'stock.read',
  STOCK_UPDATE = 'stock.update',
  STOCK_DELETE = 'stock.delete',
  STOCK_TRANSFER = 'stock.transfer',
  
  // BOQ Management
  BOQ_CREATE = 'boq.create',
  BOQ_READ = 'boq.read',
  BOQ_UPDATE = 'boq.update',
  BOQ_DELETE = 'boq.delete',
  BOQ_APPROVE = 'boq.approve',

  // Asset Management
  ASSETS_CREATE = 'assets.create',
  ASSETS_READ = 'assets.read',
  ASSETS_UPDATE = 'assets.update',
  ASSETS_DELETE = 'assets.delete',
  ASSETS_CHECKOUT = 'assets.checkout',
  ASSETS_MAINTENANCE = 'assets.maintenance',
  
  // Contractor Management
  CONTRACTORS_CREATE = 'contractors.create',
  CONTRACTORS_READ = 'contractors.read',
  CONTRACTORS_UPDATE = 'contractors.update',
  CONTRACTORS_DELETE = 'contractors.delete',
  CONTRACTORS_ASSIGN = 'contractors.assign',
  
  // Analytics & Reports
  ANALYTICS_READ = 'analytics.read',
  REPORTS_CREATE = 'reports.create',
  REPORTS_READ = 'reports.read',
  REPORTS_EXPORT = 'reports.export',
  
  // Communications
  CREATE_COMMUNICATIONS = 'communications.create',
  VIEW_COMMUNICATIONS = 'communications.read',
  
  // SOW Management
  MANAGE_SOW = 'sow.manage',
  
  // Procurement
  VIEW_PROCUREMENT = 'procurement.read',
  
  // Settings & Administration
  SETTINGS_READ = 'settings.read',
  SETTINGS_UPDATE = 'settings.update',
  USERS_MANAGE = 'users.manage',
  ROLES_MANAGE = 'roles.manage',
  
  // System Administration
  SYSTEM_ADMIN = 'system.admin',
  AUDIT_LOGS = 'audit.logs',
  BACKUPS = 'backups.manage'
}

export interface AuthState {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
}

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface RegisterCredentials {
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
}

export interface PasswordResetRequest {
  email: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface AuthError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Role-based permission mappings
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.SUPER_ADMIN]: Object.values(Permission),
  
  [UserRole.ADMIN]: [
    Permission.PROJECTS_CREATE,
    Permission.PROJECTS_READ,
    Permission.PROJECTS_UPDATE,
    Permission.PROJECTS_ASSIGN,
    Permission.STAFF_CREATE,
    Permission.STAFF_READ,
    Permission.STAFF_UPDATE,
    Permission.STAFF_ASSIGN,
    Permission.CLIENTS_CREATE,
    Permission.CLIENTS_READ,
    Permission.CLIENTS_UPDATE,
    Permission.POLES_CREATE,
    Permission.POLES_READ,
    Permission.POLES_UPDATE,
    Permission.POLES_ASSIGN,
    Permission.STOCK_CREATE,
    Permission.STOCK_READ,
    Permission.STOCK_UPDATE,
    Permission.STOCK_TRANSFER,
    Permission.BOQ_CREATE,
    Permission.BOQ_READ,
    Permission.BOQ_UPDATE,
    Permission.BOQ_APPROVE,
    Permission.CONTRACTORS_CREATE,
    Permission.CONTRACTORS_READ,
    Permission.CONTRACTORS_UPDATE,
    Permission.CONTRACTORS_ASSIGN,
    Permission.ANALYTICS_READ,
    Permission.REPORTS_CREATE,
    Permission.REPORTS_READ,
    Permission.REPORTS_EXPORT,
    Permission.SETTINGS_READ,
    Permission.SETTINGS_UPDATE,
  ],
  
  [UserRole.PROJECT_MANAGER]: [
    Permission.PROJECTS_CREATE,
    Permission.PROJECTS_READ,
    Permission.PROJECTS_UPDATE,
    Permission.PROJECTS_ASSIGN,
    Permission.STAFF_READ,
    Permission.STAFF_ASSIGN,
    Permission.CLIENTS_READ,
    Permission.CLIENTS_UPDATE,
    Permission.POLES_CREATE,
    Permission.POLES_READ,
    Permission.POLES_UPDATE,
    Permission.POLES_ASSIGN,
    Permission.STOCK_READ,
    Permission.STOCK_TRANSFER,
    Permission.BOQ_CREATE,
    Permission.BOQ_READ,
    Permission.BOQ_UPDATE,
    Permission.CONTRACTORS_READ,
    Permission.CONTRACTORS_ASSIGN,
    Permission.ANALYTICS_READ,
    Permission.REPORTS_CREATE,
    Permission.REPORTS_READ,
    Permission.REPORTS_EXPORT,
  ],
  
  [UserRole.SITE_SUPERVISOR]: [
    Permission.PROJECTS_READ,
    Permission.STAFF_READ,
    Permission.POLES_CREATE,
    Permission.POLES_READ,
    Permission.POLES_UPDATE,
    Permission.STOCK_READ,
    Permission.CONTRACTORS_READ,
    Permission.REPORTS_READ,
  ],
  
  [UserRole.FIELD_TECHNICIAN]: [
    Permission.PROJECTS_READ,
    Permission.POLES_CREATE,
    Permission.POLES_READ,
    Permission.POLES_UPDATE,
    Permission.STOCK_READ,
  ],
  
  [UserRole.CONTRACTOR]: [
    Permission.PROJECTS_READ,
    Permission.POLES_READ,
    Permission.POLES_UPDATE,
  ],
  
  [UserRole.CLIENT]: [
    Permission.PROJECTS_READ,
    Permission.REPORTS_READ,
  ],
  
  [UserRole.VIEWER]: [
    Permission.PROJECTS_READ,
    Permission.STAFF_READ,
    Permission.CLIENTS_READ,
    Permission.POLES_READ,
    Permission.STOCK_READ,
    Permission.BOQ_READ,
    Permission.CONTRACTORS_READ,
    Permission.ANALYTICS_READ,
    Permission.REPORTS_READ,
  ],
};

// Default user preferences
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: 'light',
  language: 'en',
  timezone: 'Africa/Johannesburg',
  emailNotifications: true,
  pushNotifications: true,
};