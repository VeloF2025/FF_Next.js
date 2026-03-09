/**
 * BOQ Exception Handler
 * Manages BOQ mapping exceptions and resolutions
 */

import { db } from '@/lib/neon/connection';
// @ts-ignore
import { boqExceptions, boqItems } from '@/lib/neon/schema';
// @ts-ignore
import { eq, and } from 'drizzle-orm';
// @ts-ignore
import type { BOQItem, BOQException, NewBOQException } from '@/lib/neon/schema';
import type { ApiContext, ExceptionResolution } from './types';
import { createProcurementError } from '../procurementErrors';
import { auditLogger, AuditAction } from '../auditLogger';

/**
 * Create a mapping exception
 */
export async function createMappingException(
  item: BOQItem,
  exceptionType: 'no_match' | 'multiple_matches' | 'data_issue' | 'manual_review',
  severity: 'low' | 'medium' | 'high' | 'critical',
  issueDescription: string,
  suggestedAction: string,
  systemSuggestions: any[]
): Promise<BOQException> {
  const newException: NewBOQException = {
    boqId: item.boqId,
    boqItemId: item.id,
    projectId: item.projectId,
    exceptionType,
    severity,
    issueDescription,
    suggestedAction,
    systemSuggestions,
    status: 'open',
    priority: severity === 'critical' ? 'urgent' : severity
  };

  const exceptionResult = await db
    .insert(boqExceptions)
    .values(newException)
    .returning();

  return exceptionResult[0];
}

/**
 * Resolve a BOQ mapping exception manually
 */
export async function resolveMappingException(
  context: ApiContext,
  exceptionId: string,
  resolution: ExceptionResolution
): Promise<BOQException | null> {
  // Get the exception
  const exceptionResult = await db
    .select()
    .from(boqExceptions)
    .where(
      and(
        eq(boqExceptions.id, exceptionId),
        eq(boqExceptions.projectId, context.projectId)
      )
    )
    .limit(1);

  if (exceptionResult.length === 0) {
    throw createProcurementError('NOT_FOUND', 'BOQ exception not found');
  }

  const exception = exceptionResult[0];

  // Apply resolution based on action
  if (resolution.action === 'manual_mapping' && resolution.catalogItemId) {
    // Update the BOQ item with manual mapping
    await db
      .update(boqItems)
      .set({
        catalogItemId: resolution.catalogItemId,
        catalogItemCode: resolution.catalogItemCode,
        catalogItemName: resolution.catalogItemName,
        mappingConfidence: '100', // Manual mapping has 100% confidence
        mappingStatus: 'mapped',
        updatedAt: new Date()
      })
      .where(eq(boqItems.id, exception.boqItemId));
  }

  // Update the exception as resolved
  const resolvedExceptionResult = await db
    .update(boqExceptions)
    .set({
      status: 'resolved',
      resolvedBy: context.userId,
      resolvedAt: new Date(),
      resolutionAction: resolution.action,
      resolutionNotes: resolution.resolutionNotes,
      updatedAt: new Date()
    })
    .where(eq(boqExceptions.id, exceptionId))
    .returning();

  const resolvedException = resolvedExceptionResult[0];

  // Log resolution action
  await auditLogger.logBOQAction(
    context,
    AuditAction.UPDATE,
    exception.boqId,
    exception,
    resolvedException,
    {
      operation: 'exception_resolution',
      resolutionAction: resolution.action,
      exceptionId
    }
  );

  return resolvedException;
}