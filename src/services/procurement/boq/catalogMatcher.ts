/**
 * Catalog Matcher Service
 * Handles automatic catalog matching for BOQ items
 */

// @ts-ignore
import type { BOQItem } from '@/lib/neon/schema';
import type { CatalogMatchResult } from './types';

/**
 * Perform AI-powered catalog matching for a BOQ item
 * PLACEHOLDER IMPLEMENTATION: Uses mock catalog data until real catalog service is connected
 * TODO: Integrate with actual catalog service or ML model
 */
export async function performCatalogMatching(item: BOQItem): Promise<CatalogMatchResult> {
  // MOCK CATALOG DATA - Replace with real catalog service connection
  const mockCatalogItems = [
    { id: 'cat-001', code: 'FIBER-SM-4C', name: 'Single Mode Fiber Cable 4 Core' },
    { id: 'cat-002', code: 'POLE-STEEL-9M', name: 'Steel Pole 9 Meters' },
    { id: 'cat-003', code: 'CABINET-DIST-12P', name: 'Distribution Cabinet 12 Port' }
  ];

  // Simple text matching simulation
  const description = item.description.toLowerCase();
  let bestMatch = mockCatalogItems[0];
  let confidence = 0;

  // Basic keyword matching
  if (description.includes('fiber') || description.includes('cable')) {
    bestMatch = mockCatalogItems[0];
    confidence = 85;
  } else if (description.includes('pole')) {
    bestMatch = mockCatalogItems[1];
    confidence = 90;
  } else if (description.includes('cabinet') || description.includes('distribution')) {
    bestMatch = mockCatalogItems[2];
    confidence = 80;
  } else {
    confidence = 45; // Low confidence for unknown items
  }

  return {
    confidence,
    catalogItem: bestMatch!,
    suggestions: mockCatalogItems.map(item => ({
      ...item,
      confidence: item === bestMatch ? confidence : Math.random() * 60 + 20
    }))
  };
}