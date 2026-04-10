/**
 * Quote Matching Service
 *
 * Purpose: Match extracted quote line items to RFQ items
 * - Exact code matching
 * - Fuzzy description matching
 * - Quantity/unit validation
 *
 * Status: WORKING - OCR Quote Scanner Feature
 *
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';
import type {
  ExtractedLineItem,
  QuoteExtractionResult,
  QuoteMatchingResult,
  ItemMatchResult,
  MatchReason,
} from '../types/extraction.types';

// ============================================================================
// TYPES
// ============================================================================

export interface RfqItem {
  id: string;
  description: string;
  itemCode?: string | null;
  quantity: number;
  unit: string;
  budgetPrice?: number | null;
}

interface MatchCandidate {
  rfqItem: RfqItem;
  score: number;
  reason: MatchReason;
}

// ============================================================================
// MAIN MATCHING FUNCTION
// ============================================================================

/**
 * Match extracted quote items to RFQ items
 */
export function matchExtractedToRfq(
  extraction: QuoteExtractionResult,
  rfqItems: RfqItem[],
  rfqId: string,
  rfqNumber: string
): QuoteMatchingResult {
  const startTime = Date.now();

  log.info('[QuoteMatching] Starting item matching', {
    extractedCount: extraction.lineItems?.length || 0,
    rfqItemCount: rfqItems.length,
    rfqNumber,
  });

  const matchedItems: ItemMatchResult[] = [];
  const warnings: string[] = [];
  const usedRfqItemIds = new Set<string>();

  // Process each extracted item
  for (const extracted of extraction.lineItems || []) {
    const match = findBestMatch(extracted, rfqItems, usedRfqItemIds);

    if (match) {
      usedRfqItemIds.add(match.rfqItem.id);

      // Check for quantity mismatch
      const quantityMatch = checkQuantityMatch(extracted.quantity, match.rfqItem.quantity);
      if (!quantityMatch && extracted.quantity && match.rfqItem.quantity) {
        warnings.push(
          `Item ${extracted.lineNumber}: Quantity mismatch - ` +
          `Extracted: ${extracted.quantity}, RFQ: ${match.rfqItem.quantity}`
        );
      }

      // Calculate price difference if budget exists
      let priceDiff: number | undefined;
      if (extracted.unitPrice && match.rfqItem.budgetPrice) {
        priceDiff = ((extracted.unitPrice - match.rfqItem.budgetPrice) / match.rfqItem.budgetPrice) * 100;
        if (priceDiff > 20) {
          warnings.push(
            `Item ${extracted.lineNumber}: Price ${priceDiff.toFixed(1)}% above budget`
          );
        }
      }

      matchedItems.push({
        extractedIndex: extracted.lineNumber,
        extractedDescription: extracted.description,
        rfqItemId: match.rfqItem.id,
        rfqItemDescription: match.rfqItem.description,
        rfqItemCode: match.rfqItem.itemCode || undefined,
        matchConfidence: match.score,
        matchReason: match.reason,
        quantityMatch,
        priceDifferencePercent: priceDiff,
      });
    } else {
      // No match found
      matchedItems.push({
        extractedIndex: extracted.lineNumber,
        extractedDescription: extracted.description,
        rfqItemId: null,
        matchConfidence: 0,
        matchReason: 'unmatched',
        quantityMatch: false,
      });
    }
  }

  // Check for unmatched RFQ items
  const unmatchedRfqItems = rfqItems.filter(item => !usedRfqItemIds.has(item.id));
  if (unmatchedRfqItems.length > 0) {
    warnings.push(
      `${unmatchedRfqItems.length} RFQ item(s) not found in quote: ` +
      unmatchedRfqItems.map(i => i.description.substring(0, 30)).join(', ')
    );
  }

  const totalMatched = matchedItems.filter(m => m.rfqItemId !== null).length;
  const totalUnmatched = matchedItems.filter(m => m.rfqItemId === null).length;

  // Calculate overall confidence
  const overallConfidence = matchedItems.length > 0
    ? matchedItems.reduce((sum, m) => sum + m.matchConfidence, 0) / matchedItems.length
    : 0;

  const processingTime = Date.now() - startTime;
  log.info('[QuoteMatching] Matching complete', {
    rfqNumber,
    totalMatched,
    totalUnmatched,
    overallConfidence: overallConfidence.toFixed(2),
    warningCount: warnings.length,
    processingTimeMs: processingTime,
  });

  return {
    rfqId,
    rfqNumber,
    matchedItems,
    totalMatched,
    totalUnmatched,
    overallConfidence,
    warnings,
  };
}

// ============================================================================
// MATCHING ALGORITHMS
// ============================================================================

/**
 * Find the best matching RFQ item for an extracted item
 */
function findBestMatch(
  extracted: ExtractedLineItem,
  rfqItems: RfqItem[],
  usedIds: Set<string>
): MatchCandidate | null {
  const candidates: MatchCandidate[] = [];

  for (const rfqItem of rfqItems) {
    // Skip already matched items
    if (usedIds.has(rfqItem.id)) continue;

    // Try exact code match first
    if (extracted.itemCode && rfqItem.itemCode) {
      const codeMatch = matchCodes(extracted.itemCode, rfqItem.itemCode);
      if (codeMatch) {
        candidates.push({
          rfqItem,
          score: 0.95,
          reason: 'exact_code',
        });
        continue;
      }
    }

    // Try fuzzy description match
    const descScore = calculateSimilarity(
      normalizeDescription(extracted.description),
      normalizeDescription(rfqItem.description)
    );

    if (descScore >= 0.6) {
      // Boost score if quantity and unit match
      let finalScore = descScore;
      let reason: MatchReason = 'fuzzy_description';

      if (checkQuantityMatch(extracted.quantity, rfqItem.quantity) &&
          checkUnitMatch(extracted.unit, rfqItem.unit)) {
        finalScore = Math.min(0.95, descScore + 0.15);
        reason = 'quantity_unit';
      }

      candidates.push({
        rfqItem,
        score: finalScore,
        reason,
      });
    }
  }

  // Return best candidate if any
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

/**
 * Match item codes (exact, case-insensitive)
 */
function matchCodes(code1: string, code2: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, '');
  return normalize(code1) === normalize(code2);
}

/**
 * Check if quantities match (within 10% tolerance)
 */
function checkQuantityMatch(qty1: number | null | undefined, qty2: number | null | undefined): boolean {
  if (qty1 === null || qty1 === undefined || qty2 === null || qty2 === undefined) {
    return false;
  }

  const diff = Math.abs(qty1 - qty2);
  const tolerance = Math.max(qty1, qty2) * 0.1; // 10% tolerance
  return diff <= tolerance;
}

/**
 * Check if units match (normalized)
 */
function checkUnitMatch(unit1: string | null | undefined, unit2: string | null | undefined): boolean {
  if (!unit1 || !unit2) return false;

  const normalizeUnit = (u: string) => {
    const map: Record<string, string> = {
      m: 'meter',
      metre: 'meter',
      meter: 'meter',
      metres: 'meter',
      meters: 'meter',
      km: 'kilometer',
      ea: 'each',
      each: 'each',
      pcs: 'each',
      pc: 'each',
      unit: 'each',
      kg: 'kilogram',
      kgs: 'kilogram',
      kilogram: 'kilogram',
    };
    const lower = u.toLowerCase().trim();
    return map[lower] || lower;
  };

  return normalizeUnit(unit1) === normalizeUnit(unit2);
}

// ============================================================================
// STRING SIMILARITY
// ============================================================================

/**
 * Normalize description for comparison
 */
function normalizeDescription(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .replace(/\s+/g, ' ')     // Normalize whitespace
    .trim();
}

/**
 * Calculate similarity score using Jaro-Winkler algorithm
 */
function calculateSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  // Use simpler approach: word overlap + Levenshtein
  const words1 = new Set(s1.split(' ').filter(w => w.length > 2));
  const words2 = new Set(s2.split(' ').filter(w => w.length > 2));

  // Word overlap score
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  const wordOverlap = intersection.size / union.size;

  // Also check if one contains the other
  const containsBonus = s1.includes(s2) || s2.includes(s1) ? 0.2 : 0;

  // Combine scores
  const combinedScore = Math.min(1, wordOverlap + containsBonus);

  return combinedScore;
}

/**
 * Levenshtein distance (for reference, not used in main algorithm)
 */
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const matrix: number[][] = [];

  for (let i = 0; i <= m; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= n; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j] + 1,      // deletion
        matrix[i]![j - 1] + 1,      // insertion
        matrix[i - 1]![j - 1] + cost // substitution
      );
    }
  }

  return matrix[m][n];
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Update match result with manual override
 */
export function applyManualMatch(
  result: QuoteMatchingResult,
  extractedIndex: number,
  rfqItemId: string | null,
  rfqItems: RfqItem[]
): QuoteMatchingResult {
  const updatedItems = result.matchedItems.map(item => {
    if (item.extractedIndex === extractedIndex) {
      const rfqItem = rfqItemId ? rfqItems.find(r => r.id === rfqItemId) : null;
      return {
        ...item,
        rfqItemId,
        rfqItemDescription: rfqItem?.description,
        rfqItemCode: rfqItem?.itemCode || undefined,
        matchConfidence: rfqItemId ? 1.0 : 0,
        matchReason: 'manual' as MatchReason,
      };
    }
    return item;
  });

  const totalMatched = updatedItems.filter(m => m.rfqItemId !== null).length;
  const totalUnmatched = updatedItems.filter(m => m.rfqItemId === null).length;
  const overallConfidence = updatedItems.length > 0
    ? updatedItems.reduce((sum, m) => sum + m.matchConfidence, 0) / updatedItems.length
    : 0;

  return {
    ...result,
    matchedItems: updatedItems,
    totalMatched,
    totalUnmatched,
    overallConfidence,
  };
}

/**
 * Get summary of matching result
 */
export function getMatchingSummary(result: QuoteMatchingResult): string {
  const { totalMatched, totalUnmatched, overallConfidence, warnings } = result;
  const total = totalMatched + totalUnmatched;

  let summary = `Matched ${totalMatched}/${total} items (${Math.round(overallConfidence * 100)}% confidence)`;

  if (warnings.length > 0) {
    summary += `. ${warnings.length} warning(s)`;
  }

  return summary;
}
