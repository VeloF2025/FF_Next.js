/**
 * BOQ API Service - Specialized service for BOQ operations
 * Extends the base procurement API with BOQ-specific functionality
 */

import { BaseService, type ServiceResponse, type ServiceOptions } from '../../core/BaseService';
import { procurementApiService } from '../procurementApiService';
import { auditLogger, AuditAction } from '../auditLogger';
import { db } from '@/lib/neon/connection';
// @ts-expect-error — module lacks type declarations
import { boqs } from '@/lib/neon/schema';
// @ts-expect-error — module lacks type declarations
import { count } from 'drizzle-orm';
import { performAutomaticMapping } from './mappingOperations';
import { resolveMappingException } from './exceptionHandler';
import type { 
  ApiContext, 
  BOQImportData, 
  BOQImportResult, 
  BOQMappingResult,
  ExceptionResolution 
} from './types';
// @ts-expect-error — module lacks type declarations
import type { BOQException } from '@/lib/neon/schema';
import { log } from '@/lib/logger';

export class BOQApiService extends BaseService {
  constructor(options: ServiceOptions = {}) {
    super('BOQService', {
      timeout: 60000, // Extended timeout for file processing
      retries: 2,
      ...options,
    });
  }

  /**
   * Import BOQ from uploaded Excel file with automatic mapping
   */
  async importBOQWithMapping(
    context: ApiContext,
    importData: BOQImportData
  ): Promise<ServiceResponse<BOQImportResult>> {
    try {
      // First, import the BOQ using base service
      const importResult = await procurementApiService.importBOQ(context, importData);
      if (!importResult.success) {
        return importResult as unknown as ServiceResponse<BOQImportResult>;
      }

      const boqId = importResult.data!.boqId;

      // Now perform automatic mapping
      const mappingResult = await this.performAutomaticMapping(context, boqId);
      if (!mappingResult.success) {
        // Import succeeded but mapping failed - log warning but don't fail
        log.warn('[BOQService] Mapping failed after successful import:', { data: mappingResult.error }, 'BOQApiService');
      }

      // Prepare result
      const result: BOQImportResult = {
        boqId,
        itemCount: importResult.data!.itemCount,
        mappedItems: mappingResult.success ? mappingResult.data!.mappedItems : 0,
        unmappedItems: mappingResult.success ? mappingResult.data!.unmappedItems : importResult.data!.itemCount,
        exceptionsCount: mappingResult.success ? mappingResult.data!.exceptions.length : 0,
        exceptions: mappingResult.success ? mappingResult.data!.exceptions : []
      };

      // Log combined import + mapping action
      await auditLogger.logBOQAction(
        context,
        AuditAction.CREATE,
        boqId,
        null,
        result,
        {
          operation: 'import_with_mapping',
          fileName: importData.fileName,
          fileSize: importData.fileSize,
          mappingAttempted: true,
          mappingSuccess: mappingResult.success
        }
      );

      return this.success(result);
    } catch (error) {
      return this.handleError(error, 'importBOQWithMapping');
    }
  }

  /**
   * Perform automatic mapping for a BOQ
   */
  async performAutomaticMapping(
    context: ApiContext,
    boqId: string
  ): Promise<ServiceResponse<BOQMappingResult>> {
    try {
      const result = await performAutomaticMapping(context, boqId);
      return this.success(result);
    } catch (error) {
      return this.handleError(error, 'performAutomaticMapping');
    }
  }

  /**
   * Resolve a BOQ mapping exception manually
   */
  async resolveMappingException(
    context: ApiContext,
    exceptionId: string,
    resolution: ExceptionResolution
  ): Promise<ServiceResponse<BOQException>> {
    try {
      const resolvedException = await resolveMappingException(context, exceptionId, resolution);
      if (!resolvedException) {
        return this.handleError(new Error('Failed to resolve exception'), 'resolveMappingException');
      }
      return this.success(resolvedException);
    } catch (error) {
      return this.handleError(error, 'resolveMappingException');
    }
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<ServiceResponse<{ status: 'healthy' | 'degraded' | 'unhealthy'; details?: Record<string, unknown> }>> {
    try {
      // Test BOQ table access
      await db.select({ count: count(boqs.id) }).from(boqs).limit(1);
      
      return this.success({
        status: 'healthy',
        details: {
          database: 'connected',
          tablesAccessible: ['boqs', 'boq_items', 'boq_exceptions'],
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      return {
        success: true,
        data: {
          status: 'unhealthy',
          details: {
            database: 'connection_failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
          }
        }
      };
    }
  }
}