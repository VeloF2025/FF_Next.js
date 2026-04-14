// 🟢 WORKING: Export all procurement tab components
export { DashboardTab } from './DashboardTab';
export { BOQTab } from './BOQTab';
export { RFQTab } from './RFQTab';
export { QuoteEvaluationTab } from './QuoteEvaluationTab';
export { StockMovementTab } from './StockMovementTab';
export { PurchaseOrdersTab } from './PurchaseOrdersTab';

// Re-export existing components that can be used as tabs
export { default as SuppliersTab } from '../../suppliers/SupplierPortalPage';
export { default as ReportsTab } from '../../reports/ReportsAnalyticsPage';