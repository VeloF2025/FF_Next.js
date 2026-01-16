/**
 * Material Catalog Types
 * Global material master catalog and item-level budget tracking
 *
 * Created: 2026-01-17
 * Related: BOQ Import & Budget Item Integration Plan
 */

// ============================================================================
// Enums and Type Aliases
// ============================================================================

export type MaterialStatus = 'active' | 'inactive' | 'deprecated';

export type MatchType =
  | 'exact_code'         // Item code exact match
  | 'fuzzy_description'  // Description similarity >= 85%
  | 'new_item'           // No match found, created new
  | 'duplicate_prevented' // Similar code prevented duplicate
  | 'manual_override';   // User manually selected match

/**
 * Fiber-specific budget category codes
 * Replaces generic 7 categories with 10 fiber-focused categories
 */
export type FiberBudgetCategoryCode =
  | 'CABLES'           // Cables & Fiber (drop, aerial, underground)
  | 'ENCLOSURES'       // Enclosures & Joints (FDT, NAP, splice closures)
  | 'POLES'            // Poles & Structures (creosote, stay sets)
  | 'HARDWARE'         // Hardware & Fittings (dead-ends, tangents, hooks)
  | 'SPLICING'         // Splicing & Connectivity (splitters, pigtails, midcouplers)
  | 'CIVIL'            // Civil Works & Ducting (manholes, micro duct, conduit)
  | 'HOME_CONNECTION'  // Home Connection (wall attachments, ONT, electrical)
  | 'CONSUMABLES'      // Consumables & Sundries (labels, cement, cleaning)
  | 'LABOR'            // Labor & Services (installation, testing)
  | 'CONTINGENCY';     // Contingency Reserve

// ============================================================================
// Core Entities
// ============================================================================

/**
 * Material Catalog - Global material master record
 * Item Code is the canonical identifier for deduplication
 */
export interface MaterialCatalog {
  id: string;

  // Canonical identifier (e.g., "PRE066FT")
  itemCode: string;

  // Item details
  description: string;
  category: string;              // BOQ Item Category (e.g., "Drop Cable (Connectorised)")
  budgetCategory: FiberBudgetCategoryCode;
  uom: string;                   // Unit of measure

  // Pricing
  standardRate?: number;         // Default/baseline rate

  // Matching support
  keywords?: string[];           // Extracted keywords for fuzzy matching
  normalizedDescription?: string; // Lowercase, no special chars

  // Status
  status: MaterialStatus;

  // Audit
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Material Supplier - Supplier-specific pricing for a material
 */
export interface MaterialSupplier {
  id: string;
  materialCatalogId: string;
  supplierId?: string;

  // Supplier info (denormalized)
  supplierName?: string;
  supplierCode?: string;

  // Pricing
  unitPrice: number;
  currency: string;

  // Lead time
  leadTimeDays?: number;
  leadTimeText?: string;        // E.g., "5 Weeks"

  // Preference
  isPreferred: boolean;

  // Reference codes
  supplierItemCode?: string;    // Supplier's own item code
  photonicsRef?: string;        // Photonics reference number

  // Validity
  validFrom?: string;
  validUntil?: string;

  // Audit
  createdAt: string;
  updatedAt: string;
}

/**
 * Budget Item - Item-level budget tracking
 * Links to material catalog and BOQ items for granular tracking
 */
export interface BudgetItem {
  id: string;
  projectBudgetId: string;
  budgetCategoryId: string;

  // Source references (optional)
  materialCatalogId?: string;
  boqItemId?: string;

  // Item identification
  itemCode?: string;
  description: string;
  category?: string;            // Denormalized for display
  uom?: string;

  // Budget quantities
  budgetedQuantity: number;
  budgetedRate: number;
  budgetedAmount: number;       // Generated: quantity * rate

  // Tracking amounts
  committedAmount: number;      // From approved POs
  actualAmount: number;         // From completed GRNs

  // Generated columns
  availableAmount: number;      // budgetedAmount - committedAmount
  varianceAmount: number;       // budgetedAmount - actualAmount
  variancePercent: number;

  // Metadata
  notes?: string;
  sortOrder: number;
  isManual: boolean;            // true if not from BOQ import

  // Audit
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Material Match History - Audit trail for BOQ item matching
 */
export interface MaterialMatchHistory {
  id: string;
  boqId?: string;

  // Input data
  inputItemCode?: string;
  inputDescription?: string;
  inputCategory?: string;

  // Match result
  matchedMaterialId?: string;
  matchType: MatchType;
  matchConfidence: number;      // 0.0 to 1.0

  // Details
  matchDetails?: Record<string, unknown>;

  // Audit
  createdBy?: string;
  createdAt: string;
}

/**
 * BOQ Category Mapping - Maps BOQ categories to budget categories
 */
export interface BOQCategoryMapping {
  id: string;
  boqCategory: string;          // BOQ Item Category name
  budgetCategoryCode: FiberBudgetCategoryCode;
  keywords?: string[];          // For fuzzy matching
  priority: number;             // Lower = higher priority

  // Audit
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Composite Types (for UI display)
// ============================================================================

/**
 * Material with supplier pricing info
 */
export interface MaterialWithPricing extends MaterialCatalog {
  suppliers: MaterialSupplier[];
  preferredSupplier?: MaterialSupplier;
  lowestPrice?: number;
  highestPrice?: number;
}

/**
 * Budget Item with category info (for display)
 */
export interface BudgetItemWithCategory extends BudgetItem {
  categoryCode: FiberBudgetCategoryCode;
  categoryName: string;
}

/**
 * Budget Item with material info (for detailed view)
 */
export interface BudgetItemWithMaterial extends BudgetItemWithCategory {
  material?: MaterialCatalog;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Request to create a new material in the catalog
 */
export interface CreateMaterialRequest {
  itemCode: string;
  description: string;
  category?: string;
  budgetCategory: FiberBudgetCategoryCode;
  uom?: string;
  standardRate?: number;
  keywords?: string[];
}

/**
 * Request to update a material
 */
export interface UpdateMaterialRequest {
  description?: string;
  category?: string;
  budgetCategory?: FiberBudgetCategoryCode;
  uom?: string;
  standardRate?: number;
  keywords?: string[];
  status?: MaterialStatus;
}

/**
 * Request to add supplier pricing
 */
export interface AddSupplierPricingRequest {
  materialCatalogId: string;
  supplierId?: string;
  supplierName?: string;
  supplierCode?: string;
  unitPrice: number;
  currency?: string;
  leadTimeDays?: number;
  leadTimeText?: string;
  isPreferred?: boolean;
  supplierItemCode?: string;
  photonicsRef?: string;
}

/**
 * Request to create budget item
 */
export interface CreateBudgetItemRequest {
  budgetCategoryId: string;
  materialCatalogId?: string;
  boqItemId?: string;
  itemCode?: string;
  description: string;
  uom?: string;
  budgetedQuantity: number;
  budgetedRate: number;
  notes?: string;
  sortOrder?: number;
}

/**
 * Material search parameters
 */
export interface MaterialSearchParams {
  query?: string;              // Search in description, itemCode
  budgetCategory?: FiberBudgetCategoryCode;
  category?: string;           // BOQ category
  status?: MaterialStatus;
  limit?: number;
  offset?: number;
  sortBy?: 'itemCode' | 'description' | 'category' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Budget items search parameters
 */
export interface BudgetItemSearchParams {
  projectBudgetId: string;
  categoryId?: string;
  boqItemId?: string;
  materialCatalogId?: string;
  search?: string;             // Search description
  sortBy?: 'itemCode' | 'description' | 'budgetedAmount' | 'varianceAmount';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Budget items list response
 */
export interface BudgetItemsResponse {
  items: BudgetItemWithCategory[];
  totals: {
    budgeted: number;
    committed: number;
    actual: number;
    available: number;
  };
  count: number;
}

/**
 * Material match result from import
 */
export interface MaterialMatchResult {
  inputItemCode?: string;
  inputDescription: string;
  matchType: MatchType;
  matchedMaterial?: MaterialCatalog;
  matchConfidence: number;
  isNewMaterial: boolean;
  potentialDuplicates?: MaterialCatalog[];
}

/**
 * BOQ import result with material matching stats
 */
export interface BOQImportResult {
  success: boolean;
  boqId: string;
  itemsProcessed: number;
  materialsMatched: number;
  materialsCreated: number;
  duplicatesPrevented: number;
  budgetItemsCreated: number;
  totalBudgetAmount: number;
  categoryBreakdown: {
    code: FiberBudgetCategoryCode;
    name: string;
    itemCount: number;
    totalAmount: number;
  }[];
  errors?: string[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Fiber-specific budget categories (replaces generic 7)
 */
export const FIBER_BUDGET_CATEGORIES = [
  { code: 'CABLES' as const, name: 'Cables & Fiber', sortOrder: 1 },
  { code: 'ENCLOSURES' as const, name: 'Enclosures & Joints', sortOrder: 2 },
  { code: 'POLES' as const, name: 'Poles & Structures', sortOrder: 3 },
  { code: 'HARDWARE' as const, name: 'Hardware & Fittings', sortOrder: 4 },
  { code: 'SPLICING' as const, name: 'Splicing & Connectivity', sortOrder: 5 },
  { code: 'CIVIL' as const, name: 'Civil Works & Ducting', sortOrder: 6 },
  { code: 'HOME_CONNECTION' as const, name: 'Home Connection', sortOrder: 7 },
  { code: 'CONSUMABLES' as const, name: 'Consumables & Sundries', sortOrder: 8 },
  { code: 'LABOR' as const, name: 'Labor & Services', sortOrder: 9 },
  { code: 'CONTINGENCY' as const, name: 'Contingency Reserve', sortOrder: 10 },
] as const;

/**
 * Match confidence threshold for fuzzy matching
 */
export const MATCH_CONFIDENCE_THRESHOLD = 0.85;

/**
 * Duplicate prevention threshold (similar item codes)
 */
export const DUPLICATE_CODE_THRESHOLD = 0.80;
