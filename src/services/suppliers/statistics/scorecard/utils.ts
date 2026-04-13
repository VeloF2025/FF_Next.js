/**
 * Scorecard Utilities Module
 * Common utility functions for scorecard generation
 */

import { Supplier } from '@/types/supplier/base.types';

export class SupplierUtils {
  /**
   * Get supplier rating value
   */
  static getSupplierRating(supplier: Supplier): number {
    if (typeof supplier.rating === 'number') {
      return supplier.rating;
    }
    if (supplier.rating && typeof supplier.rating === 'object') {
      return supplier.rating.overall || 0;
    }
    return 0;
  }

  /**
   * Calculate percentile ranking
   */
  static calculatePercentile(value: number, sortedArray: number[]): number {
    if (sortedArray.length === 0) return 50;
    
    const index = sortedArray.findIndex(v => v >= value);
    if (index === -1) return 100; // Higher than all values
    
    return (index / sortedArray.length) * 100;
  }

  /**
   * Get supplier display name
   */
  static getSupplierDisplayName(supplier: Supplier): string {
    return supplier.companyName || supplier.name || 'Unknown Supplier';
  }

  /**
   * Check if supplier has complete contact information
   */
  static hasCompleteContact(supplier: Supplier): boolean {
    return !!(supplier.primaryContact?.email && supplier.primaryContact?.phone);
  }

  /**
   * Get supplier categories as string
   */
  static getCategoriesString(supplier: Supplier): string {
    if (!supplier.categories || supplier.categories.length === 0) {
      return 'No categories';
    }
    return supplier.categories.join(', ');
  }

  /**
   * Calculate data completeness percentage
   */
  static calculateDataCompleteness(supplier: Supplier): number {
    const fields = [
      supplier.companyName || supplier.name,
      supplier.primaryContact?.email,
      supplier.addresses?.physical,
      supplier.businessType,
      supplier.categories?.length,
      supplier.rating,
      supplier.performance,
      supplier.complianceStatus
    ];

    const completedFields = fields.filter(field => 
      field !== null && field !== undefined && field !== ''
    ).length;

    return Math.round((completedFields / fields.length) * 100);
  }

  /**
   * Validate supplier ID format
   */
  static isValidSupplierId(supplierId: string): boolean {
    return typeof supplierId === 'string' && supplierId.trim().length > 0;
  }

  /**
   * Get supplier status display string
   */
  static getStatusDisplay(supplier: Supplier): string {
    if (supplier.blacklisted || supplier.isBlacklisted) return 'Blacklisted';
    if (supplier.isPreferred) return 'Preferred';
    if (supplier.status === 'active') return 'Active';
    if (supplier.status === 'inactive') return 'Inactive';
    if (supplier.status === 'pending') return 'Pending';
    return 'Unknown';
  }

  /**
   * Calculate trend direction
   */
  static calculateTrend(current: number, previous: number): {
    direction: 'up' | 'down' | 'stable';
    percentage: number;
  } {
    if (previous === 0) {
      return { direction: 'stable', percentage: 0 };
    }

    const change = ((current - previous) / previous) * 100;
    const threshold = 5; // 5% threshold for considering it stable

    if (Math.abs(change) < threshold) {
      return { direction: 'stable', percentage: Math.round(change * 100) / 100 };
    }

    return {
      direction: change > 0 ? 'up' : 'down',
      percentage: Math.round(Math.abs(change) * 100) / 100
    };
  }

  /**
   * Format score for display
   */
  static formatScore(score: number, decimals: number = 1): string {
    return score.toFixed(decimals);
  }

  /**
   * Get performance category based on score
   */
  static getPerformanceCategory(score: number): {
    category: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
    color: string;
    label: string;
  } {
    if (score >= 90) {
      return { category: 'excellent', color: '#10b981', label: 'Excellent' };
    }
    if (score >= 80) {
      return { category: 'good', color: '#3b82f6', label: 'Good' };
    }
    if (score >= 60) {
      return { category: 'fair', color: '#f59e0b', label: 'Fair' };
    }
    if (score >= 40) {
      return { category: 'poor', color: '#ef4444', label: 'Poor' };
    }
    return { category: 'critical', color: '#dc2626', label: 'Critical' };
  }

  /**
   * Deep clone object (for safe data manipulation)
   */
  static deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (obj instanceof Date) {
      return new Date(obj.getTime()) as unknown as T;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClone(item)) as unknown as T;
    }

    const cloned = {} as T;
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        cloned[key] = this.deepClone(obj[key]);
      }
    }

    return cloned;
  }

  /**
   * Safe number conversion
   */
  static toSafeNumber(value: unknown, defaultValue: number = 0): number {
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
  }

  /**
   * Generate unique identifier
   */
  static generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}