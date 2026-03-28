// ============= RFQ Types Module Index =============

// Re-export all enum types
export {
  RFQStatus,
  type RFQStatusType,
  QuoteStatus,
  type QuoteStatusType,
  SupplierInvitationStatus,
  type SupplierInvitationStatusType,
  type QuoteDocumentType
} from './enums.types';

// Re-export core RFQ types
export {
  type RFQ,
  type RFQItem
} from './core.types';

// Re-export supplier types
export {
  type SupplierInvitation,
  type SupplierQuoteSubmission
} from './supplier.types';

// Re-export quote types
export {
  type Quote,
  type QuoteItem,
  type QuoteDocument
} from './quote.types';

// Re-export evaluation types
export {
  type EvaluationCriteria,
  type QuoteComparison,
  type RFQStats
} from './evaluation.types';

// Re-export form types
export {
  type RFQFormData,
  type RFQWithDetails
} from './forms.types';

// Type exports that match Drizzle inferred types
// TODO: Uncomment when RFQ tables are added to src/lib/neon/schema.ts
// export type { RFQ as DrizzleRFQ, NewRFQ as NewDrizzleRFQ } from '../../../lib/neon/schema';
// export type { RFQItem as DrizzleRFQItem, NewRFQItem as NewDrizzleRFQItem } from '../../../lib/neon/schema';
// export type { SupplierInvitation as DrizzleSupplierInvitation, NewSupplierInvitation as NewDrizzleSupplierInvitation } from '../../../lib/neon/schema';
// export type { Quote as DrizzleQuote, NewQuote as NewDrizzleQuote } from '../../../lib/neon/schema';
// export type { QuoteItem as DrizzleQuoteItem, NewQuoteItem as NewDrizzleQuoteItem } from '../../../lib/neon/schema';
// export type { QuoteDocument as DrizzleQuoteDocument, NewQuoteDocument as NewDrizzleQuoteDocument } from '../../../lib/neon/schema';