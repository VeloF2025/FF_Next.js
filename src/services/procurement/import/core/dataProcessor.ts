/**
 * BOQ Import Data Processor
 * Handles data validation, mapping, and transformation
 */

import { ParsedBOQItem } from '../../../../lib/utils/excelParser';
import { BOQItemForMatching, MatchResult, MappingException } from '../../../../lib/utils/catalogMatcher';
import { ImportConfig, MappingResults } from './types';
import { BOQImportCatalogManager } from './catalogManager';

export class BOQImportDataProcessor {
  private catalogManager: BOQImportCatalogManager;

  constructor(catalogManager: BOQImportCatalogManager) {
    this.catalogManager = catalogManager;
  }

  /**
   * Validate parsed BOQ items
   */
  validateParsedItems(items: ParsedBOQItem[]): ParsedBOQItem[] {
    return items.filter(item => {
      return item.description && 
             item.quantity > 0 && 
             item.uom &&
             item.description.trim().length > 0;
    });
  }

  /**
   * Map BOQ items to catalog
   */
  async mapToCatalog(
    items: ParsedBOQItem[], 
    config: ImportConfig
  ): Promise<MappingResults> {
    const mapped: Array<ParsedBOQItem & { catalogMatch: MatchResult }> = [];
    const exceptions: Array<ParsedBOQItem & { exception: MappingException }> = [];

    const catalogMatcher = this.catalogManager.getCatalogMatcher();
    
    if (!catalogMatcher) {
      // If no catalog matcher, treat all as exceptions
      items.forEach(item => {
        exceptions.push({
          ...item,
          exception: this.createMappingException(item, [])
        });
      });
      return { mapped, exceptions };
    }

    for (const item of items) {
      const boqItem: BOQItemForMatching = {
        description: item.description,
        uom: item.uom,
        ...(item.itemCode !== undefined && item.itemCode !== null && { itemCode: item.itemCode }),
        ...(item.category !== undefined && item.category !== null && { category: item.category })
      };

      const matches = await catalogMatcher.findMatches(boqItem);
      
      if (matches.length > 0 && matches[0]!.confidence >= config.minMappingConfidence) {
        mapped.push({
          ...item,
          catalogMatch: matches[0]!
        });
      } else {
        exceptions.push({
          ...item,
          exception: this.createMappingException(item, matches)
        });
      }
    }

    return { mapped, exceptions };
  }

  /**
   * Create mapping exception
   */
  private createMappingException(
    item: ParsedBOQItem,
    suggestions: MatchResult[]
  ): MappingException {
    const boqItem: BOQItemForMatching = {
      description: item.description,
      uom: item.uom,
      ...(item.itemCode !== undefined && item.itemCode !== null && { itemCode: item.itemCode }),
      ...(item.category !== undefined && item.category !== null && { category: item.category })
    };

    return {
      id: `exc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      boqItem,
      suggestions,
      status: 'pending',
      createdAt: new Date(),
      priority: suggestions.length > 0 ? 'medium' : 'high'
    };
  }

  /**
   * Clean and normalize BOQ item data
   */
  cleanBOQItem(item: ParsedBOQItem): ParsedBOQItem {
    return {
      ...item,
      description: item.description.trim(),
      itemCode: item.itemCode ? (item.itemCode.trim() || null) : null,
      category: item.category ? (item.category.trim() || null) : null,
      uom: item.uom.trim().toLowerCase(),
      quantity: Math.max(0, item.quantity),
      unitPrice: item.unitPrice ? Math.max(0, item.unitPrice) : null
    };
  }

  /**
   * Group BOQ items by category
   */
  groupItemsByCategory(items: ParsedBOQItem[]): Map<string, ParsedBOQItem[]> {
    const groups = new Map<string, ParsedBOQItem[]>();
    
    items.forEach(item => {
      const category = item.category || 'Uncategorized';
      const existing = groups.get(category) || [];
      existing.push(item);
      groups.set(category, existing);
    });

    return groups;
  }

  /**
   * Calculate mapping statistics
   */
  calculateMappingStats(results: MappingResults): {
    mappingRate: number;
    averageConfidence: number;
    highConfidenceCount: number;
    mediumConfidenceCount: number;
    lowConfidenceCount: number;
  } {
    const totalItems = results.mapped.length + results.exceptions.length;
    const mappingRate = totalItems > 0 ? (results.mapped.length / totalItems) * 100 : 0;
    
    const confidences = results.mapped.map(item => item.catalogMatch.confidence);
    const averageConfidence = confidences.length > 0 
      ? confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length
      : 0;

    const highConfidenceCount = confidences.filter(conf => conf >= 0.9).length;
    const mediumConfidenceCount = confidences.filter(conf => conf >= 0.7 && conf < 0.9).length;
    const lowConfidenceCount = confidences.filter(conf => conf < 0.7).length;

    return {
      mappingRate,
      averageConfidence,
      highConfidenceCount,
      mediumConfidenceCount,
      lowConfidenceCount
    };
  }

  /**
   * Find duplicate BOQ items
   */
  findDuplicates(items: ParsedBOQItem[]): ParsedBOQItem[][] {
    const duplicateGroups: ParsedBOQItem[][] = [];
    const processed = new Set<number>();

    for (let i = 0; i < items.length; i++) {
      if (processed.has(i)) continue;

      const currentItem = items[i]!;
      const duplicates = [currentItem];
      processed.add(i);

      for (let j = i + 1; j < items.length; j++) {
        if (processed.has(j)) continue;

        const otherItem = items[j]!;
        if (this.areItemsSimilar(currentItem, otherItem)) {
          duplicates.push(otherItem);
          processed.add(j);
        }
      }

      if (duplicates.length > 1) {
        duplicateGroups.push(duplicates as ParsedBOQItem[]);
      }
    }

    return duplicateGroups;
  }

  /**
   * Check if two BOQ items are similar (potential duplicates)
   */
  private areItemsSimilar(item1: ParsedBOQItem, item2: ParsedBOQItem): boolean {
    const desc1 = item1.description.toLowerCase().trim();
    const desc2 = item2.description.toLowerCase().trim();
    const uom1 = item1.uom.toLowerCase().trim();
    const uom2 = item2.uom.toLowerCase().trim();

    // Exact description match with same UOM
    if (desc1 === desc2 && uom1 === uom2) {
      return true;
    }

    // Similar description (>80% similarity) with same UOM
    const similarity = this.calculateStringSimilarity(desc1, desc2);
    return similarity > 0.8 && uom1 === uom2;
  }

  /**
   * Calculate string similarity using Levenshtein distance
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => 
      Array(str1.length + 1).fill(null)
    );

    for (let i = 0; i <= str1.length; i++) matrix[0]![i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j]![0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j]![i] = Math.min(
          matrix[j]![i - 1]! + 1,
          matrix[j - 1]![i]! + 1,
          matrix[j - 1]![i - 1]! + indicator
        );
      }
    }

    return matrix[str2.length]![str1.length]!;
  }
}