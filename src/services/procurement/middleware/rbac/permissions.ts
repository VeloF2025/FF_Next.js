/**
 * RBAC Permissions and Roles Configuration
 * Defines all procurement-specific permissions and role mappings
 */

// Procurement-specific permissions
export enum ProcurementPermission {
  // BOQ Permissions
  BOQ_READ = 'boq:read',
  BOQ_CREATE = 'boq:create',
  BOQ_WRITE = 'boq:write',
  BOQ_DELETE = 'boq:delete',
  BOQ_APPROVE = 'boq:approve',
  BOQ_IMPORT = 'boq:import',
  BOQ_EXPORT = 'boq:export',
  BOQ_MAPPING = 'boq:mapping',
  BOQ_BULK_UPDATE = 'boq:bulk_update',

  // RFQ Permissions
  RFQ_READ = 'rfq:read',
  RFQ_CREATE = 'rfq:create',
  RFQ_WRITE = 'rfq:write',
  RFQ_DELETE = 'rfq:delete',
  RFQ_ISSUE = 'rfq:issue',
  RFQ_CLOSE = 'rfq:close',
  RFQ_EXTEND = 'rfq:extend',

  // Quote Permissions
  QUOTE_READ = 'quote:read',
  QUOTE_EVALUATE = 'quote:evaluate',
  QUOTE_AWARD = 'quote:award',
  QUOTE_REJECT = 'quote:reject',

  // Supplier Portal Permissions
  SUPPLIER_ACCESS = 'supplier:access',
  SUPPLIER_INVITE = 'supplier:invite',
  SUPPLIER_MANAGE = 'supplier:manage',

  // Stock Permissions
  STOCK_READ = 'stock:read',
  STOCK_ACCESS = 'stock:access',
  STOCK_CREATE = 'stock:create',
  STOCK_WRITE = 'stock:write',
  STOCK_MOVE = 'stock:move',
  STOCK_ADJUST = 'stock:adjust',
  STOCK_COUNT = 'stock:count',

  // Reporting Permissions
  PROCUREMENT_REPORTS = 'procurement:reports',
  PROCUREMENT_ANALYTICS = 'procurement:analytics',
  PROCUREMENT_AUDIT = 'procurement:audit',

  // Field Stock Sub-Permissions
  FIELD_STOCK_PICKING_MANAGE = 'field_stock:picking:manage',    // process, confirm, sign
  FIELD_STOCK_PICKING_CANCEL = 'field_stock:picking:cancel',
  FIELD_STOCK_RETURN_MANAGE = 'field_stock:return:manage',      // inspect, accept
  FIELD_STOCK_MOVEMENT_REVERSE = 'field_stock:movement:reverse',
  FIELD_STOCK_ACCOUNTABILITY_MANAGE = 'field_stock:accountability:manage', // block/unblock/reconcile
  FIELD_STOCK_FAULT_READ = 'field_stock:fault:read',
  FIELD_STOCK_FAULT_MANAGE = 'field_stock:fault:manage',
  FIELD_STOCK_SERIAL_MANAGE = 'field_stock:serial:manage',
  FIELD_STOCK_LOCATION_MANAGE = 'field_stock:location:manage',

  // Audit Permissions
  AUDIT_READ = 'audit:read',
  AUDIT_EXPORT = 'audit:export',

  // GRN Extended
  GRN_CONFIRM = 'grn:confirm',
  GRN_REGISTER_ASSETS = 'grn:register_assets'
}

// Role definitions for procurement module
export const ProcurementRoles = {
  // Procurement Manager - Full access to all procurement functions
  PROCUREMENT_MANAGER: {
    permissions: [
      ProcurementPermission.BOQ_READ,
      ProcurementPermission.BOQ_CREATE,
      ProcurementPermission.BOQ_WRITE,
      ProcurementPermission.BOQ_DELETE,
      ProcurementPermission.BOQ_APPROVE,
      ProcurementPermission.BOQ_IMPORT,
      ProcurementPermission.BOQ_EXPORT,
      ProcurementPermission.BOQ_MAPPING,
      ProcurementPermission.RFQ_READ,
      ProcurementPermission.RFQ_CREATE,
      ProcurementPermission.RFQ_WRITE,
      ProcurementPermission.RFQ_DELETE,
      ProcurementPermission.RFQ_ISSUE,
      ProcurementPermission.RFQ_CLOSE,
      ProcurementPermission.RFQ_EXTEND,
      ProcurementPermission.QUOTE_READ,
      ProcurementPermission.QUOTE_EVALUATE,
      ProcurementPermission.QUOTE_AWARD,
      ProcurementPermission.QUOTE_REJECT,
      ProcurementPermission.SUPPLIER_ACCESS,
      ProcurementPermission.SUPPLIER_INVITE,
      ProcurementPermission.SUPPLIER_MANAGE,
      ProcurementPermission.STOCK_READ,
      ProcurementPermission.STOCK_ACCESS,
      ProcurementPermission.STOCK_CREATE,
      ProcurementPermission.STOCK_WRITE,
      ProcurementPermission.STOCK_MOVE,
      ProcurementPermission.STOCK_ADJUST,
      ProcurementPermission.STOCK_COUNT,
      ProcurementPermission.PROCUREMENT_REPORTS,
      ProcurementPermission.PROCUREMENT_ANALYTICS,
      ProcurementPermission.PROCUREMENT_AUDIT,
      ProcurementPermission.FIELD_STOCK_PICKING_MANAGE,
      ProcurementPermission.FIELD_STOCK_PICKING_CANCEL,
      ProcurementPermission.FIELD_STOCK_RETURN_MANAGE,
      ProcurementPermission.FIELD_STOCK_MOVEMENT_REVERSE,
      ProcurementPermission.FIELD_STOCK_ACCOUNTABILITY_MANAGE,
      ProcurementPermission.FIELD_STOCK_FAULT_READ,
      ProcurementPermission.FIELD_STOCK_FAULT_MANAGE,
      ProcurementPermission.FIELD_STOCK_SERIAL_MANAGE,
      ProcurementPermission.FIELD_STOCK_LOCATION_MANAGE,
      ProcurementPermission.AUDIT_READ,
      ProcurementPermission.AUDIT_EXPORT,
      ProcurementPermission.GRN_CONFIRM,
      ProcurementPermission.GRN_REGISTER_ASSETS
    ]
  },

  // Procurement Officer - Standard procurement operations
  PROCUREMENT_OFFICER: {
    permissions: [
      ProcurementPermission.BOQ_READ,
      ProcurementPermission.BOQ_CREATE,
      ProcurementPermission.BOQ_WRITE,
      ProcurementPermission.BOQ_IMPORT,
      ProcurementPermission.BOQ_EXPORT,
      ProcurementPermission.BOQ_MAPPING,
      ProcurementPermission.RFQ_READ,
      ProcurementPermission.RFQ_CREATE,
      ProcurementPermission.RFQ_WRITE,
      ProcurementPermission.RFQ_ISSUE,
      ProcurementPermission.QUOTE_READ,
      ProcurementPermission.QUOTE_EVALUATE,
      ProcurementPermission.SUPPLIER_ACCESS,
      ProcurementPermission.SUPPLIER_INVITE,
      ProcurementPermission.STOCK_READ,
      ProcurementPermission.STOCK_ACCESS,
      ProcurementPermission.PROCUREMENT_REPORTS,
      ProcurementPermission.FIELD_STOCK_PICKING_MANAGE,
      ProcurementPermission.FIELD_STOCK_RETURN_MANAGE,
      ProcurementPermission.FIELD_STOCK_FAULT_READ,
      ProcurementPermission.FIELD_STOCK_FAULT_MANAGE,
      ProcurementPermission.FIELD_STOCK_SERIAL_MANAGE,
      ProcurementPermission.AUDIT_READ,
      ProcurementPermission.GRN_CONFIRM
    ]
  },

  // Stock Manager - Stock operations focus
  STOCK_MANAGER: {
    permissions: [
      ProcurementPermission.BOQ_READ,
      ProcurementPermission.RFQ_READ,
      ProcurementPermission.QUOTE_READ,
      ProcurementPermission.STOCK_READ,
      ProcurementPermission.STOCK_ACCESS,
      ProcurementPermission.STOCK_CREATE,
      ProcurementPermission.STOCK_WRITE,
      ProcurementPermission.STOCK_MOVE,
      ProcurementPermission.STOCK_ADJUST,
      ProcurementPermission.STOCK_COUNT,
      ProcurementPermission.PROCUREMENT_REPORTS,
      ProcurementPermission.FIELD_STOCK_PICKING_MANAGE,
      ProcurementPermission.FIELD_STOCK_PICKING_CANCEL,
      ProcurementPermission.FIELD_STOCK_RETURN_MANAGE,
      ProcurementPermission.FIELD_STOCK_MOVEMENT_REVERSE,
      ProcurementPermission.FIELD_STOCK_ACCOUNTABILITY_MANAGE,
      ProcurementPermission.FIELD_STOCK_FAULT_READ,
      ProcurementPermission.FIELD_STOCK_FAULT_MANAGE,
      ProcurementPermission.FIELD_STOCK_SERIAL_MANAGE,
      ProcurementPermission.FIELD_STOCK_LOCATION_MANAGE,
      ProcurementPermission.AUDIT_READ,
      ProcurementPermission.GRN_CONFIRM,
      ProcurementPermission.GRN_REGISTER_ASSETS
    ]
  },

  // Project Manager - Read access + BOQ approval
  PROJECT_MANAGER: {
    permissions: [
      ProcurementPermission.BOQ_READ,
      ProcurementPermission.BOQ_APPROVE,
      ProcurementPermission.BOQ_EXPORT,
      ProcurementPermission.RFQ_READ,
      ProcurementPermission.RFQ_CLOSE,
      ProcurementPermission.QUOTE_READ,
      ProcurementPermission.QUOTE_AWARD,
      ProcurementPermission.STOCK_READ,
      ProcurementPermission.PROCUREMENT_REPORTS,
      ProcurementPermission.PROCUREMENT_ANALYTICS,
      ProcurementPermission.FIELD_STOCK_FAULT_READ,
      ProcurementPermission.AUDIT_READ,
      ProcurementPermission.AUDIT_EXPORT
    ]
  },

  // Engineer - Read and BOQ management
  ENGINEER: {
    permissions: [
      ProcurementPermission.BOQ_READ,
      ProcurementPermission.BOQ_CREATE,
      ProcurementPermission.BOQ_WRITE,
      ProcurementPermission.BOQ_IMPORT,
      ProcurementPermission.BOQ_EXPORT,
      ProcurementPermission.BOQ_MAPPING,
      ProcurementPermission.RFQ_READ,
      ProcurementPermission.QUOTE_READ,
      ProcurementPermission.STOCK_READ,
      ProcurementPermission.PROCUREMENT_REPORTS,
      ProcurementPermission.FIELD_STOCK_FAULT_READ,
      ProcurementPermission.AUDIT_READ
    ]
  },

  // Viewer - Read-only access
  VIEWER: {
    permissions: [
      ProcurementPermission.BOQ_READ,
      ProcurementPermission.RFQ_READ,
      ProcurementPermission.QUOTE_READ,
      ProcurementPermission.STOCK_READ,
      ProcurementPermission.PROCUREMENT_REPORTS,
      ProcurementPermission.FIELD_STOCK_FAULT_READ,
      ProcurementPermission.AUDIT_READ
    ]
  }
} as const;

/**
 * Role mapping from FibreFlow system roles to procurement roles
 */
export const ROLE_MAPPING: Record<string, keyof typeof ProcurementRoles> = {
  'OWNER': 'PROCUREMENT_MANAGER',
  'ADMIN': 'PROCUREMENT_MANAGER',
  'PROJECT_MANAGER': 'PROJECT_MANAGER',
  'PROCUREMENT_MANAGER': 'PROCUREMENT_MANAGER',
  'PROCUREMENT_OFFICER': 'PROCUREMENT_OFFICER',
  'STOCK_MANAGER': 'STOCK_MANAGER',
  'LEAD_ENGINEER': 'ENGINEER',
  'ENGINEER': 'ENGINEER',
  'TECHNICIAN': 'VIEWER',
  'VIEWER': 'VIEWER',
  'READ_ONLY': 'VIEWER'
};

/**
 * Get permissions for a specific role
 */
export function getRolePermissions(role: string): ProcurementPermission[] {
  const normalizedRole = role.toUpperCase().replace(/[^A-Z_]/g, '_');
  const procurementRole = ROLE_MAPPING[normalizedRole] || 'VIEWER';
  return [...ProcurementRoles[procurementRole].permissions];
}

/**
 * Check if a role has a specific permission
 */
export function roleHasPermission(role: string, permission: ProcurementPermission): boolean {
  const rolePermissions = getRolePermissions(role);
  return rolePermissions.includes(permission);
}

/**
 * Get all permissions for multiple roles
 */
export function getCombinedRolePermissions(roles: string[]): ProcurementPermission[] {
  const permissions = new Set<ProcurementPermission>();
  
  roles.forEach(role => {
    const rolePermissions = getRolePermissions(role);
    rolePermissions.forEach(permission => permissions.add(permission));
  });
  
  return Array.from(permissions);
}