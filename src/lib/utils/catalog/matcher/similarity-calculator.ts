/**
 * Similarity Calculator - String matching and scoring algorithms
 */

import { MatchResult, MatchConfig, BOQItemForMatching, CatalogItem } from '../types';
import { TextProcessor } from '../textProcessor';

export class SimilarityCalculator {
  
  /**
   * Calculate match score between BOQ item and catalog item
   */
  calculateMatch(boqItem: BOQItemForMatching, catalogItem: CatalogItem, config: MatchConfig): MatchResult {
    let totalScore = 0;
    let maxScore = 0;
    const matchedFields: string[] = [];
    const reasons: string[] = [];
    
    // Code matching
    if (boqItem.itemCode && catalogItem.code) {
      const codeScore = this.calculateStringScore(boqItem.itemCode, catalogItem.code);
      totalScore += codeScore * config.codeWeight;
      maxScore += config.codeWeight;
      
      if (codeScore > 0.8) {
        matchedFields.push('code');
        reasons.push(`Code similarity: ${Math.round(codeScore * 100)}%`);
      }
    }
    
    // Description matching
    const descScore = this.calculateStringScore(boqItem.description, catalogItem.description);
    totalScore += descScore * config.descriptionWeight;
    maxScore += config.descriptionWeight;
    
    if (descScore > 0.6) {
      matchedFields.push('description');
      reasons.push(`Description similarity: ${Math.round(descScore * 100)}%`);
    }
    
    // UOM matching
    const uomMatch = boqItem.uom.toLowerCase() === catalogItem.uom.toLowerCase();
    if (config.strictUomMatching && !uomMatch) {
      return {
        catalogItem,
        confidence: 0,
        matchType: 'partial',
        matchedFields: [],
        reason: 'UOM mismatch (strict mode)'
      };
    }
    
    if (uomMatch) {
      totalScore += 0.1; // Small boost for UOM match
      matchedFields.push('uom');
      reasons.push('UOM match');
    }
    
    // Category matching
    if (boqItem.category && catalogItem.category) {
      const categoryScore = this.calculateStringScore(boqItem.category, catalogItem.category);
      if (categoryScore > 0.8) {
        totalScore += 0.1;
        matchedFields.push('category');
        reasons.push('Category match');
      }
    }
    
    // Calculate final confidence
    const baseConfidence = maxScore > 0 ? totalScore / maxScore : 0;
    let confidence = baseConfidence;
    
    // Apply exact match boost
    if (matchedFields.includes('code') && boqItem.itemCode === catalogItem.code) {
      confidence = Math.min(1.0, confidence + config.exactMatchBoost);
    }
    
    // Determine match type
    const matchType = this.determineMatchType(confidence, matchedFields);
    
    return {
      catalogItem,
      confidence,
      matchType,
      matchedFields,
      reason: reasons.join(', ') || `${Math.round(confidence * 100)}% match`
    };
  }

  /**
   * Calculate string similarity score
   */
  calculateStringScore(str1: string, str2: string): number {
    // Use exact match for high score
    if (str1.toLowerCase() === str2.toLowerCase()) return 1.0;
    
    // Check if one contains the other
    if (TextProcessor.contains(str1, str2) || TextProcessor.contains(str2, str1)) {
      return 0.8;
    }
    
    // Use fuzzy similarity
    return TextProcessor.similarity(str1, str2);
  }

  /**
   * Determine match type based on confidence and matched fields
   */
  private determineMatchType(confidence: number, matchedFields: string[]): 'exact' | 'fuzzy' | 'partial' | 'keyword' {
    if (confidence >= 0.95) return 'exact';
    if (confidence >= 0.8) return 'fuzzy';
    if (matchedFields.length > 0) return 'keyword';
    return 'partial';
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => 
      Array(str1.length + 1).fill(null)
    );
    
    for (let i = 0; i <= str1.length; i++) matrix[0]![i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j]![0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j]![i] = Math.min(
          matrix[j]![i - 1] + 1,
          matrix[j - 1]![i] + 1,
          matrix[j - 1]![i - 1] + indicator
        );
      }
    }
    
    return matrix[str2.length]![str1.length];
  }

  /**
   * Calculate Jaro-Winkler similarity
   */
  jaroWinklerSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    
    const len1 = str1.length;
    const len2 = str2.length;
    const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
    
    if (matchWindow < 0) return 0.0;
    
    const str1Matches = new Array(len1).fill(false);
    const str2Matches = new Array(len2).fill(false);
    
    let matches = 0;
    let transpositions = 0;
    
    // Find matches
    for (let i = 0; i < len1; i++) {
      const start = Math.max(0, i - matchWindow);
      const end = Math.min(i + matchWindow + 1, len2);
      
      for (let j = start; j < end; j++) {
        if (str2Matches[j] || str1[i] !== str2[j]) continue;
        str1Matches[i] = true;
        str2Matches[j] = true;
        matches++;
        break;
      }
    }
    
    if (matches === 0) return 0.0;
    
    // Find transpositions
    let k = 0;
    for (let i = 0; i < len1; i++) {
      if (!str1Matches[i]) continue;
      while (!str2Matches[k]) k++;
      if (str1[i] !== str2[k]) transpositions++;
      k++;
    }
    
    const jaro = (matches / len1 + matches / len2 + 
                  (matches - transpositions / 2) / matches) / 3;
    
    // Winkler prefix bonus
    let prefix = 0;
    for (let i = 0; i < Math.min(len1, len2, 4); i++) {
      if (str1[i] === str2[i]) prefix++;
      else break;
    }
    
    return jaro + (0.1 * prefix * (1 - jaro));
  }
}