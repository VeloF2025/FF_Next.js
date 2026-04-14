// Procurement Module - Main Exports
// Following FibreFlow Universal Module Structure

// Main Layout and Navigation
export { ProcurementDashboard } from './components/ProcurementDashboard';

// BOQ Management
export { 
  BOQDashboard,
  BOQCreate, 
  BOQEdit,
  BOQView,
  BOQList,
  BOQDetail,
  BOQUpload,
  BOQMappingReview,
  BOQViewer,
  BOQHistory
} from './boq/components';

// RFQ Management
export {
  RFQDashboard,
  RFQCreate,
  RFQEdit,
  RFQView,
  RFQList,
  RFQDetail,
  RFQBuilder,
  RFQDistribution,
  RFQTracking,
  RFQArchive
} from './rfq/components';

// Quote Evaluation
export {
  QuoteEvaluationDashboard,
  QuoteComparison,
  EvaluationMatrix,
  AwardProcess,
  QuoteHistory
} from './quote-evaluation/components';

// Supplier Portal
export {
  SupplierPortalDashboard,
  SupplierDashboard,
  RFQResponse,
  DocumentManagement,
  CommunicationCenter
} from './supplier-portal/components';

// Stock Management
export {
  StatusBadge,
  StockStatsCards,
  StockFilters,
  StockItemCard,
  MovementsTab,
  TransfersTab
} from './stock/components';

// Purchase Orders
export {
  PurchaseOrderDashboard,
  PurchaseOrderCreate,
  PurchaseOrderEdit,
  PurchaseOrderView,
  PurchaseOrderList,
  PurchaseOrderDetail
} from './purchase-orders/components';

// Reporting
export {
  PnLReport,
  CostBreakdownMatrix,
  ProjectFinancialSummary
} from './reporting/components';

// Shared Components
export { ProcurementErrorBoundary } from './components/error/ProcurementErrorBoundary';
export { ProcurementBreadcrumbs } from './components/common/ProcurementBreadcrumbs';

// Hooks
export { 
  useBoqs,
  useRfqs,
  useProcurementPermissions
} from './hooks';

// Types
export type * from '@/types/procurement';