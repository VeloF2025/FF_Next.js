/**
 * BOQ Mapping Operations
 * Handles automatic and manual BOQ item mapping
 */

import { db } from '@/lib/neon/connection';
// @ts-ignore
import { boqs, boqItems } from '@/lib/neon/schema';
// @ts-ignore
import { eq, and, isNull } from 'drizzle-orm';
import { auditLogger, AuditAction } from '../auditLogger';
import { performCatalogMatching } from './catalogMatcher';
import { createMappingException } from './exceptionHandler';
import type { ApiContext, BOQMappingResult } from './types';
// @ts-ignore
import type { BOQException } from '@/lib/neon/schema';

/**
 * Perform automatic mapping for a BOQ
 */
export async function performAutomaticMapping(
  context: ApiContext,
  boqId: string
): Promise<BOQMappingResult> {
  // Get all unmapped items
  const unmappedItems = await db
    .select()
    .from(boqItems)
    .where(
      and(
        eq(boqItems.boqId, boqId),
        eq(boqItems.projectId, context.projectId),
        isNull(boqItems.catalogItemId)
      )
    );

  const exceptions: BOQException[] = [];
  let mappedCount = 0;
  let totalConfidence = 0;

  // Process each item for mapping
  for (const item of unmappedItems) {
    try {
      const mappingResult = await performCatalogMatching(item);

      if (mappingResult.confidence >= 75) {
        // High confidence - auto-map
        await db
          .update(boqItems)
          .set({
            catalogItemId: mappingResult.catalogItem.id,
            catalogItemCode: mappingResult.catalogItem.code,
            catalogItemName: mappingResult.catalogItem.name,
            mappingConfidence: mappingResult.confidence.toString(),
            mappingStatus: 'mapped',
            updatedAt: new Date()
          })
          .where(eq(boqItems.id, item.id));

        mappedCount++;
        totalConfidence += mappingResult.confidence;
      } else if (mappingResult.confidence >= 50) {
        // Medium confidence - create exception for manual review
        const exception = await createMappingException(
          item,
          'multiple_matches',
          'medium',
          'Multiple catalog matches found. Manual review required.',
          `${mappingResult.suggestions.length} possible matches found with confidence ${mappingResult.confidence}%`,
          mappingResult.suggestions
        );
        exceptions.push(exception);
      } else {
        // Low confidence - create exception for no match
        const exception = await createMappingException(
          item,
          'no_match',
          'high',
          'No suitable catalog match found.',
          'Item description does not match any catalog items with sufficient confidence.',
          []
        );
        exceptions.push(exception);
      }
    } catch (itemError) {
      // Create data issue exception
      const exception = await createMappingException(
        item,
        'data_issue',
        'medium',
        'Error processing item for mapping.',
        itemError instanceof Error ? itemError.message : 'Unknown processing error',
        []
      );
      exceptions.push(exception);
    }
  }

  // Calculate overall mapping confidence
  const overallConfidence = mappedCount > 0 ? totalConfidence / mappedCount : 0;

  // Update BOQ with mapping statistics
  await db
    .update(boqs)
    .set({
      mappingStatus: exceptions.length > 0 ? 'completed' : 'completed',
      mappingConfidence: overallConfidence.toString(),
      mappedItems: mappedCount,
      unmappedItems: unmappedItems.length - mappedCount,
      exceptionsCount: exceptions.length,
      updatedAt: new Date()
    })
    .where(eq(boqs.id, boqId));

  const result: BOQMappingResult = {
    boqId,
    totalItems: unmappedItems.length,
    mappedItems: mappedCount,
    unmappedItems: unmappedItems.length - mappedCount,
    exceptions,
    mappingConfidence: overallConfidence
  };

  // Log mapping action
  await auditLogger.logBOQAction(
    context,
    AuditAction.UPDATE,
    boqId,
    null,
    result,
    {
      operation: 'automatic_mapping',
      mappingConfidence: overallConfidence,
      exceptionsCreated: exceptions.length
    }
  );

  return result;
}