/**
 * Supplier Search Sorting and Ranking
 * Sort and rank suppliers based on various criteria
 */

import { Supplier } from '@/types/supplier/base.types';

export class SupplierSortingService {
  /**
   * Get supplier rating value (handles both number and object types)
   */
  private static getSupplierRating(supplier: Supplier): number {
    if (typeof supplier.rating === 'number') {
      return supplier.rating;
    } else if (supplier.rating && typeof supplier.rating === 'object') {
      return supplier.rating.overall || 0;
    }
    return 0;
  }
  /**
   * Apply sorting to supplier results
   */
  static applySorting(
    suppliers: Supplier[], 
    sortBy?: 'name' | 'rating' | 'createdAt' | 'updatedAt',
    sortOrder?: 'asc' | 'desc'
  ): Supplier[] {
    if (!sortBy) {
      return suppliers;
    }

    const sorted = [...suppliers].sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'name':
          comparison = (a.companyName || '').localeCompare(b.companyName || '');
          break;
        case 'rating':
          comparison = (this.getSupplierRating(a) || 0) - (this.getSupplierRating(b) || 0);
          break;
        case 'createdAt':
          comparison = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
          break;
        case 'updatedAt':
          comparison = new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime();
          break;
        default:
          return 0;
      }
      
      return sortOrder === 'desc' ? -comparison : comparison;
    });
    
    return sorted;
  }

  /**
   * Fuzzy search suppliers by name with similarity scoring
   */
  static fuzzySearchSuppliers(suppliers: Supplier[], searchTerm: string): Supplier[] {
    const searchResults = suppliers
      .map(supplier => ({
        supplier,
        similarity: this.calculateStringSimilarity(
          supplier.companyName?.toLowerCase() || '',
          searchTerm.toLowerCase()
        )
      }))
      .filter(result => result.similarity > 0.1) // Minimum similarity threshold
      .sort((a, b) => b.similarity - a.similarity)
      .map(result => result.supplier);
    
    return searchResults;
  }

  /**
   * Calculate string similarity using Levenshtein distance
   */
  private static calculateStringSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1;
    if (str1.length === 0 || str2.length === 0) return 0;
    
    // Check if one string contains the other
    if (str1.includes(str2) || str2.includes(str1)) {
      return 0.8;
    }
    
    const distance = this.levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);
    return 1 - (distance / maxLength);
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private static levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0]![j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i]![j] = matrix[i - 1]![j - 1]!;
        } else {
          matrix[i]![j] = Math.min(
            matrix[i - 1]![j - 1]! + 1,
            matrix[i]![j - 1]! + 1,
            matrix[i - 1]![j]! + 1
          );
        }
      }
    }

    return matrix[str2.length]![str1.length] ?? 0;
  }
}