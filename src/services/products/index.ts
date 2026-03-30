/**
 * Product Services - Modular Export
 * Centralized export for all product service modules
 */

// Types and interfaces
export type {
  Product,
  ProductFormData,
  ProductAvailability,
  ProductCategory,
  PriceList,
  PriceListItem,
  ProductFilter,
  PriceAdjustment,
  CreatePriceListData,
  ProductCallback
} from './types';

// CRUD operations
export { ProductCrudService } from './crud';

// Status management
export { ProductStatusService } from './status';

// Search and query
export { ProductSearchService } from './search';

// Pricing and price lists
export { ProductPricingService } from './pricing';

// Real-time subscriptions
export { ProductSubscriptionService } from './subscriptions';

// Main service orchestrator (for backward compatibility)
export { ProductService } from './productService';