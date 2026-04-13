/**
 * Catalog Matcher Types
 * Type definitions for catalog item matching
 */

// Catalog item structure
export interface CatalogItem {
  id: string;
  code: string;
  description: string;
  category: string;
  subcategory?: string;
  uom: string;
  price?: number; // Optional price for matching
  specifications?: Record<string, unknown>;
  aliases?: string[]; // Alternative names/codes
  keywords?: string[]; // Search keywords
  status: 'active' | 'inactive' | 'discontinued';
}

// Matching result
export interface MatchResult {
  catalogItem: CatalogItem;
  confidence: number; // 0-1 scale
  matchType: 'exact' | 'fuzzy' | 'partial' | 'keyword';
  matchedFields: string[]; // Fields that contributed to the match
  reason: string; // Human-readable explanation
}

// Matching configuration
export interface MatchConfig {
  minConfidence: number; // Minimum confidence threshold (default: 0.6)
  maxResults: number; // Maximum results to return (default: 5)
  exactMatchBoost: number; // Boost for exact matches (default: 0.3)
  codeWeight: number; // Weight for code matching (default: 0.4)
  descriptionWeight: number; // Weight for description matching (default: 0.6)
  enableFuzzyMatching: boolean; // Enable fuzzy string matching (default: true)
  enableKeywordMatching: boolean; // Enable keyword matching (default: true)
  strictUomMatching: boolean; // Require UOM to match (default: false)
}

// BOQ item for matching
export interface BOQItemForMatching {
  itemCode?: string;
  description: string;
  uom: string;
  category?: string;
  subcategory?: string;
  estimatedPrice?: number; // Optional estimated price for matching
  keywords?: string[];
}

export interface MappingException {
  id: string;
  boqItem: BOQItemForMatching;
  suggestions: MatchResult[];
  status: 'pending' | 'resolved' | 'ignored';
  resolution?: {
    selectedCatalogItemId?: string;
    action: 'map' | 'create_new' | 'ignore';
    notes?: string;
    resolvedBy: string;
    resolvedAt: Date;
  };
  createdAt: Date;
  priority: 'high' | 'medium' | 'low';
}