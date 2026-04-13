/**
 * Supplier Search Filters and Client-side Processing
 * Advanced filtering logic for supplier search results
 */

import { Supplier } from '@/types/supplier/base.types';
import { SupplierSearchFilters } from './types';

export class SupplierFilterProcessor {
  /**
   * Apply client-side filters for complex criteria
   */
  static applyClientSideFilters(suppliers: Supplier[], filters: SupplierSearchFilters): Supplier[] {
    return suppliers.filter(supplier => {
      // Search term filter (fuzzy matching will be applied separately)
      if (filters.searchTerm && !this.matchesSearchTerm(supplier, filters.searchTerm)) {
        return false;
      }
      
      // Category filter (if not already applied in query)
      if (filters.categories && filters.categories.length > 0) {
        const hasMatchingCategory = filters.categories.some(cat => 
          supplier.categories?.includes(cat as unknown as import('@/types/supplier/common.types').ProductCategory)
        );
        if (!hasMatchingCategory) {
          return false;
        }
      }
      
      // Preferred status filter
      if (filters.isPreferred !== undefined && supplier.isPreferred !== filters.isPreferred) {
        return false;
      }
      
      // Rating range filter
      if (filters.minRating || filters.maxRating) {
        const rating = this.getSupplierRating(supplier);
        if (filters.minRating && rating < filters.minRating) {
          return false;
        }
        if (filters.maxRating && rating > filters.maxRating) {
          return false;
        }
      }
      
      // Location filter
      if (filters.location && !this.matchesLocation(supplier, filters.location)) {
        return false;
      }
      
      // Business type filter
      if (filters.businessType && supplier.businessType !== filters.businessType) {
        return false;
      }
      
      // Document availability filter
      if (filters.hasDocuments !== undefined) {
        const hasDocuments = this.hasRequiredDocuments(supplier);
        if (filters.hasDocuments !== hasDocuments) {
          return false;
        }
      }
      
      // Compliance filter
      if (filters.isCompliant !== undefined) {
        const isCompliant = this.isSupplierCompliant(supplier);
        if (filters.isCompliant !== isCompliant) {
          return false;
        }
      }
      
      return true;
    });
  }

  /**
   * Filter suppliers by location
   */
  static filterByLocation(suppliers: Supplier[], location: string): Supplier[] {
    return suppliers.filter(supplier => {
      const address = supplier.addresses?.physical;
      if (!address) return false;
      
      const locationFields = [
        address.city,
        address.state,
        address.country
      ].map(field => field?.toLowerCase() || '');
      
      const searchTerm = location.toLowerCase();
      return locationFields.some(field => field.includes(searchTerm));
    });
  }

  /**
   * Filter suppliers for RFQ matching
   */
  static filterForRFQ(suppliers: Supplier[], criteria: {
    categories: string[];
    location?: string;
    minRating?: number;
    excludeSuppliers?: string[];
    requiredCertifications?: string[];
  }): Supplier[] {
    return suppliers.filter(supplier => {
      // Exclude specified suppliers
      if (criteria.excludeSuppliers?.includes(supplier.id)) {
        return false;
      }
      
      // Check category match
      const hasMatchingCategory = criteria.categories.some(cat => 
        supplier.categories?.some(supplierCat => supplierCat.toString() === cat.toString())
      );
      if (!hasMatchingCategory) {
        return false;
      }
      
      // Check minimum rating
      if (criteria.minRating) {
        const rating = this.getSupplierRating(supplier);
        if (rating < criteria.minRating) {
          return false;
        }
      }
      
      // Check required certifications
      if (criteria.requiredCertifications && criteria.requiredCertifications.length > 0) {
        const supplierCerts = supplier.certifications?.map(cert => cert.type) || [];
        const hasRequiredCerts = criteria.requiredCertifications.every(reqCert =>
          supplierCerts.includes(reqCert)
        );
        if (!hasRequiredCerts) {
          return false;
        }
      }
      
      return true;
    });
  }

  /**
   * Check if supplier matches search term
   */
  private static matchesSearchTerm(supplier: Supplier, searchTerm: string): boolean {
    const term = searchTerm.toLowerCase();
    const fields = [
      supplier.companyName,
      supplier.email,
      supplier.businessType,
      ...(supplier.categories || []),
      supplier.addresses?.physical?.city,
      supplier.addresses?.physical?.state
    ].map(field => (field || '').toLowerCase());
    
    return fields.some(field => field.includes(term));
  }

  /**
   * Check if supplier matches location
   */
  private static matchesLocation(supplier: Supplier, location: string): boolean {
    const address = supplier.addresses?.physical;
    if (!address) return false;
    
    const locationFields = [
      address.city,
      address.state,
      address.country
    ].map(field => field?.toLowerCase() || '');
    
    const searchTerm = location.toLowerCase();
    return locationFields.some(field => field.includes(searchTerm));
  }

  /**
   * Check if supplier has required documents
   */
  private static hasRequiredDocuments(supplier: Supplier): boolean {
    return !!(supplier.documents && 
              supplier.documents.length > 0 && 
              supplier.documents.some(doc => doc.status === 'approved'));
  }

  /**
   * Check if supplier is compliant
   */
  private static isSupplierCompliant(supplier: Supplier): boolean {
    const hasValidCertifications = supplier.certifications?.some(cert => 
      cert.status === 'active' && cert.expiryDate && new Date(cert.expiryDate) > new Date()
    );
    
    const hasApprovedDocuments = this.hasRequiredDocuments(supplier);
    
    return !!(hasValidCertifications && hasApprovedDocuments);
  }

  /**
   * Get supplier overall rating
   */
  private static getSupplierRating(supplier: Supplier): number {
    if (typeof supplier.rating === 'number') {
      return supplier.rating;
    } else if (supplier.rating && typeof supplier.rating === 'object') {
      return supplier.rating.overall || 0;
    }
    return 0;
  }
}