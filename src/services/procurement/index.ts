/**
 * Procurement Module - Main Export Index
 * Central exports for all procurement services and utilities
 */

// Main API Services
export { procurementApiService, default as ProcurementApiService } from './procurementApiService';
export { boqApiService, default as BOQApiService } from './boqApiService';

// Error Handling
export * from './procurementErrors';
export { 
  ProcurementError,
  BOQError,
  BOQMappingError,
  RFQError,
  RFQValidationError,
  QuoteError,
  StockError,
  InsufficientStockError,
  ProcurementPermissionError,
  ProcurementErrorCodes,
  ErrorStatusCodes,
  createProcurementError,
  handleProcurementError,
  createValidationError,
  logProcurementError
} from './procurementErrors';

// Middleware
export { projectAccessMiddleware, ProjectAccessLevel } from './middleware/projectAccessMiddleware';
export { rbacMiddleware, ProcurementPermission, ProcurementRoles } from './middleware/rbacMiddleware';

// Audit Logging
export { auditLogger, AuditAction, AuditEntityType } from './auditLogger';

// Re-export validation schemas for convenience
export { ProcurementSchemas, validateSchema } from '@/lib/validation';

// Type exports for external use
export type { ServiceResponse } from '@/services/core/BaseService';

// Import services for use in functions
import { procurementApiService } from './procurementApiService';
import { boqApiService } from './boqApiService';
import { projectAccessMiddleware } from './middleware/projectAccessMiddleware';
import { rbacMiddleware, ProcurementPermission } from './middleware/rbacMiddleware';
import { handleProcurementError } from './procurementErrors';
import { log } from '@/lib/logger';

// API Context interface for external integrations
export interface ProcurementApiContext {
  userId: string;
  userName?: string;
  userRole?: string;
  projectId: string;
  permissions: string[];
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  source?: 'web' | 'mobile' | 'api';
}

// Pagination parameters interface
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Filter interfaces for different entities
export interface BOQFilters extends PaginationParams {
  status?: string;
  mappingStatus?: string;
  uploadedBy?: string;
}

export interface RFQFilters extends PaginationParams {
  status?: string;
  createdBy?: string;
  responseDeadline?: { from?: string; to?: string };
}

export interface StockFilters extends PaginationParams {
  category?: string;
  stockStatus?: string;
  warehouseLocation?: string;
}

// Procurement service initialization
export const initializeProcurementServices = async (): Promise<{
  success: boolean;
  services: string[];
  healthStatus: Record<string, unknown>;
}> => {
  try {
    // Check health of all services
    const mainServiceHealth = await procurementApiService.getHealthStatus();
    const boqServiceHealth = await boqApiService.getHealthStatus();
    
    const allHealthy = mainServiceHealth.success && 
                      boqServiceHealth.success && 
                      mainServiceHealth.data?.status === 'healthy' &&
                      boqServiceHealth.data?.status === 'healthy';

    return {
      success: allHealthy,
      services: ['procurementApiService', 'boqApiService', 'auditLogger', 'projectAccessMiddleware', 'rbacMiddleware'],
      healthStatus: {
        mainService: mainServiceHealth.data,
        boqService: boqServiceHealth.data,
        overall: allHealthy ? 'healthy' : 'degraded'
      }
    };
  } catch (error) {
    return {
      success: false,
      services: [],
      healthStatus: {
        error: error instanceof Error ? error.message : 'Unknown error',
        overall: 'unhealthy'
      }
    };
  }
};

// Utility functions for common operations
export const ProcurementUtils = {
  /**
   * Create API context from authentication data
   */
  createApiContext: (
    userId: string,
    projectId: string,
    options: {
      userName?: string;
      userRole?: string;
      permissions?: string[];
      ipAddress?: string;
      userAgent?: string;
      sessionId?: string;
      source?: 'web' | 'mobile' | 'api';
    } = {}
  ): ProcurementApiContext => {
    const context: ProcurementApiContext = {
      userId,
      projectId,
      permissions: options.permissions || [],
      source: options.source || 'web'
    };
    
    if (options.userName) context.userName = options.userName;
    if (options.userRole) context.userRole = options.userRole;
    if (options.ipAddress) context.ipAddress = options.ipAddress;
    if (options.userAgent) context.userAgent = options.userAgent;
    if (options.sessionId) context.sessionId = options.sessionId;
    
    return context;
  },

  /**
   * Check if user has procurement module access
   */
  hasProcurementAccess: async (userId: string, projectId: string): Promise<boolean> => {
    try {
      const accessCheck = await projectAccessMiddleware.checkProjectAccess(userId, projectId);
      if (!accessCheck.success) return false;

      const permissionCheck = await rbacMiddleware.checkAnyPermission(
        userId,
        [ProcurementPermission.BOQ_READ, ProcurementPermission.RFQ_READ, ProcurementPermission.STOCK_READ],
        projectId
      );
      
      return permissionCheck.success && permissionCheck.data === true;
    } catch (error) {
      log.error('[ProcurementUtils] Error checking procurement access:', { data: error }, 'index');
      return false;
    }
  },

  /**
   * Get user's procurement permissions for a project
   */
  getUserProcurementPermissions: async (userId: string, projectId: string): Promise<string[]> => {
    try {
      const userPermissions = await rbacMiddleware.getUserPermissions(userId, projectId);
      if (!userPermissions.success) return [];

      return Array.from(userPermissions.data!.permissions);
    } catch (error) {
      log.error('[ProcurementUtils] Error getting user permissions:', { data: error }, 'index');
      return [];
    }
  },

  /**
   * Format error for API response
   */
  formatErrorResponse: (error: unknown) => {
    return handleProcurementError(error);
  },

  /**
   * Create audit context from API context
   */
  createAuditContext: (apiContext: ProcurementApiContext) => ({
    userId: apiContext.userId,
    userName: apiContext.userName,
    userRole: apiContext.userRole,
    projectId: apiContext.projectId,
    ipAddress: apiContext.ipAddress,
    userAgent: apiContext.userAgent,
    sessionId: apiContext.sessionId,
    source: apiContext.source
  })
};

// Default export for main service
export default procurementApiService;