/**
 * Ticketing Module - Type Definitions Index
 * 🟢 WORKING: Central export file for all ticketing types
 *
 * Re-exports all TypeScript type definitions for the ticketing module.
 * These types match the database schema defined in migration files.
 */

// Ticket types and enums
export * from './ticket';

// Verification and QA readiness types
export * from './verification';

// Guarantee and billing types
export * from './guarantee';

// Risk acceptance types
export * from './riskAcceptance';

// Handover and ownership transfer types
export * from './handover';

// Repeat fault escalation types
export * from './escalation';

// WhatsApp notification types
export * from './whatsapp';

// QContact integration types
export * from './qcontact';

// Weekly report import types
export * from './weeklyReport';

// Attachment types
export * from './attachment';

// Note types
export * from './note';

/**
 * Common API response wrapper
 */
export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Pagination metadata
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

/**
 * Paginated API response
 */
export interface PaginatedAPIResponse<T> {
  success: boolean;
  data: T[];
  pagination: PaginationMeta;
  error?: string;
}

/**
 * Common filter operators
 */
export type FilterOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'like' | 'between';

/**
 * Sort order
 */
export type SortOrder = 'asc' | 'desc';

/**
 * Common sort options
 */
export interface SortOptions {
  field: string;
  order: SortOrder;
}

/**
 * Date range filter
 */
export interface DateRangeFilter {
  start: Date;
  end: Date;
}

/**
 * Bulk operation request
 */
export interface BulkOperationRequest<T = any> {
  ids: string[];
  operation: string;
  data?: T;
}

/**
 * Bulk operation result
 */
export interface BulkOperationResult {
  total: number;
  successful: number;
  failed: number;
  errors: Array<{
    id: string;
    error: string;
  }>;
}
