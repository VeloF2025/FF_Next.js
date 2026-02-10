import { lazy } from 'react';

// Core
export const Dashboard = lazy(() => import('@/modules/dashboard/Dashboard').then(m => ({ default: m.Dashboard })));
export const VFThemeTest = lazy(() => import('@/pages/test/VFThemeTest'));

// Client Module
export const ClientsPage = lazy(() => import('@/modules/clients/ClientsPage').then(m => ({ default: m.ClientsPage })));
export const ClientCreatePage = lazy(() => import('@/modules/clients/ClientCreatePage').then(m => ({ default: m.ClientCreatePage })));
export const ClientEditPage = lazy(() => import('@/modules/clients/ClientEditPage').then(m => ({ default: m.ClientEditPage })));
export const ClientDetailPage = lazy(() => import('@/modules/clients/ClientDetailPage').then(m => ({ default: m.ClientDetailPage })));

// Staff Module
export const StaffPage = lazy(() => import('@/modules/staff/StaffPage').then(m => ({ default: m.StaffPage })));
export const StaffCreatePage = lazy(() => import('@/modules/staff/StaffCreatePage').then(m => ({ default: m.StaffCreatePage })));
export const StaffEditPage = lazy(() => import('@/modules/staff/StaffEditPage').then(m => ({ default: m.StaffEditPage })));
export const StaffDetailPage = lazy(() => import('@/modules/staff/StaffDetailPage').then(m => ({ default: m.StaffDetailPage })));
export const StaffImport = lazy(() => import('@/modules/staff/StaffImport').then(m => ({ default: m.StaffImport })));
export const StaffSettings = lazy(() => import('@/modules/settings/StaffSettings').then(m => ({ default: m.StaffSettings })));

// Procurement Module - Main Layout
export const ProcurementPage = lazy(() => import('@/modules/procurement/ProcurementPage').then(m => ({ default: m.ProcurementPage })));
export const ProcurementOverview = lazy(() => import('@/modules/procurement/ProcurementOverview').then(m => ({ default: m.ProcurementOverview })));
export const ProcurementLayout = lazy(() => import('@/modules/procurement/components/layout/ProcurementLayout').then(m => ({ default: m.ProcurementLayout })));
export const ProcurementDashboard = lazy(() => import('@/modules/procurement/components/ProcurementDashboard/ProcurementDashboard').then(m => ({ default: m.ProcurementDashboard })));

// BOQ Management
export const BOQDashboard = lazy(() => import('@/modules/procurement/boq/components').then(m => ({ default: m.BOQDashboard })));
export const BOQCreate = lazy(() => import('@/modules/procurement/boq/components').then(m => ({ default: m.BOQCreate })));
export const BOQEdit = lazy(() => import('@/modules/procurement/boq/components').then(m => ({ default: m.BOQEdit })));
export const BOQView = lazy(() => import('@/modules/procurement/boq/components').then(m => ({ default: m.BOQView })));
export const BOQList = lazy(() => import('@/modules/procurement/boq/components').then(m => ({ default: m.BOQList })));
export const BOQUpload = lazy(() => import('@/modules/procurement/boq/components').then(m => ({ default: m.BOQUpload })));
export const BOQMappingReview = lazy(() => import('@/modules/procurement/boq/components').then(m => ({ default: m.BOQMappingReview })));
export const BOQViewer = lazy(() => import('@/modules/procurement/boq/components').then(m => ({ default: m.BOQViewer })));
export const BOQHistory = lazy(() => import('@/modules/procurement/boq/components').then(m => ({ default: m.BOQHistory })));

// RFQ Management
export const RFQDashboard = lazy(() => import('@/modules/procurement/rfq/components').then(m => ({ default: m.RFQDashboard })));
export const RFQCreate = lazy(() => import('@/modules/procurement/rfq/components').then(m => ({ default: m.RFQCreate })));
export const RFQEdit = lazy(() => import('@/modules/procurement/rfq/components').then(m => ({ default: m.RFQEdit })));
export const RFQView = lazy(() => import('@/modules/procurement/rfq/components').then(m => ({ default: m.RFQView })));
export const RFQList = lazy(() => import('@/modules/procurement/rfq/components').then(m => ({ default: m.RFQList })));
export const RFQBuilder = lazy(() => import('@/modules/procurement/rfq/components').then(m => ({ default: m.RFQBuilder })));
export const RFQDistribution = lazy(() => import('@/modules/procurement/rfq/components').then(m => ({ default: m.RFQDistribution })));
export const RFQTracking = lazy(() => import('@/modules/procurement/rfq/components').then(m => ({ default: m.RFQTracking })));
export const RFQArchive = lazy(() => import('@/modules/procurement/rfq/components').then(m => ({ default: m.RFQArchive })));

// Quote Evaluation
export const QuoteEvaluationDashboard = lazy(() => import('@/modules/procurement/quote-evaluation/components').then(m => ({ default: m.QuoteEvaluationDashboard })));
export const QuoteComparison = lazy(() => import('@/modules/procurement/quote-evaluation/components').then(m => ({ default: m.QuoteComparison })));
export const EvaluationMatrix = lazy(() => import('@/modules/procurement/quote-evaluation/components').then(m => ({ default: m.EvaluationMatrix })));
export const AwardProcess = lazy(() => import('@/modules/procurement/quote-evaluation/components').then(m => ({ default: m.AwardProcess })));
export const QuoteHistory = lazy(() => import('@/modules/procurement/quote-evaluation/components').then(m => ({ default: m.QuoteHistory })));

// Stock Management
export const StockManagementDashboard = lazy(() => import('@/modules/procurement/stock/StockManagement').then(m => ({ default: m.default })));
export const StockDashboard = lazy(() => import('@/modules/procurement/stock/components').then(m => ({ default: m.StockDashboard })));
export const GoodsReceipt = lazy(() => import('@/modules/procurement/stock/components').then(m => ({ default: m.GoodsReceipt })));
export const StockMovements = lazy(() => import('@/modules/procurement/stock/components').then(m => ({ default: m.StockMovements })));
export const DrumTracking = lazy(() => import('@/modules/procurement/stock/components').then(m => ({ default: m.DrumTracking })));

// Purchase Orders
export const PurchaseOrderDashboard = lazy(() => import('@/modules/procurement/purchase-orders/components').then(m => ({ default: m.PurchaseOrderDashboard })));
export const PurchaseOrderCreate = lazy(() => import('@/modules/procurement/purchase-orders/components').then(m => ({ default: m.PurchaseOrderCreate })));
export const PurchaseOrderEdit = lazy(() => import('@/modules/procurement/purchase-orders/components').then(m => ({ default: m.PurchaseOrderEdit })));
export const PurchaseOrderView = lazy(() => import('@/modules/procurement/purchase-orders/components').then(m => ({ default: m.PurchaseOrderView })));
export const PurchaseOrderList = lazy(() => import('@/modules/procurement/purchase-orders/components').then(m => ({ default: m.PurchaseOrderList })));

// Supplier Portal
export const SupplierPortalDashboard = lazy(() => import('@/modules/procurement/supplier-portal/components').then(m => ({ default: m.SupplierPortalDashboard })));
export const SuppliersPage = lazy(() => import('@/modules/suppliers/SuppliersPage').then(m => ({ default: m.SuppliersPage })));
export const SuppliersPortalPage = lazy(() => import('@/modules/suppliers/SuppliersPortalPage').then(m => ({ default: m.SuppliersPortalPage })));

// Reporting
export const ProcurementReporting = lazy(() => import('@/modules/procurement/reporting/components').then(m => ({ default: m.ProcurementReporting })));
export const ProcurementKPIDashboard = lazy(() => import('@/modules/procurement/reporting/components').then(m => ({ default: m.ProcurementKPIDashboard })));
export const CostAnalysis = lazy(() => import('@/modules/procurement/reporting/components').then(m => ({ default: m.CostAnalysis })));
export const SupplierPerformance = lazy(() => import('@/modules/procurement/reporting/components').then(m => ({ default: m.SupplierPerformance })));
export const ComplianceReports = lazy(() => import('@/modules/procurement/reporting/components').then(m => ({ default: m.ComplianceReports })));

// Communications Module
export const MeetingsDashboard = lazy(() => import('@/modules/meetings/MeetingsDashboard').then(m => ({ default: m.MeetingsDashboard })));
export const ActionItemsDashboard = lazy(() => import('@/modules/action-items/ActionItemsDashboard').then(m => ({ default: m.ActionItemsDashboard })));
export const PendingActionItems = lazy(() => import('@/modules/action-items/pages/PendingActionItems').then(m => ({ default: m.PendingActionItems })));
export const CompletedActionItems = lazy(() => import('@/modules/action-items/pages/CompletedActionItems').then(m => ({ default: m.CompletedActionItems })));
export const OverdueActionItems = lazy(() => import('@/modules/action-items/pages/OverdueActionItems').then(m => ({ default: m.OverdueActionItems })));
export const ActionItemsByMeeting = lazy(() => import('@/modules/action-items/pages/ActionItemsByMeeting').then(m => ({ default: m.ActionItemsByMeeting })));
export const ActionItemsByAssignee = lazy(() => import('@/modules/action-items/pages/ActionItemsByAssignee').then(m => ({ default: m.ActionItemsByAssignee })));
export const ActionItemsSearch = lazy(() => import('@/modules/action-items/pages/ActionItemsSearch').then(m => ({ default: m.ActionItemsSearch })));
export const TasksDashboard = lazy(() => import('@/modules/tasks/TasksDashboard').then(m => ({ default: m.TasksDashboard })));

// SOW Module
export const SOWDashboard = lazy(() => import('@/modules/sow/SOWDashboard').then(m => ({ default: m.SOWDashboard })));
export const SOWListPage = lazy(() => import('@/modules/sow/SOWListPage').then(m => ({ default: m.SOWListPage })));
export const SOWImportPage = lazy(() => import('@/modules/sow/SOWImportPage').then(m => ({ default: m.SOWImportPage })));

// Field Operations
export const OneMapDashboard = lazy(() => import('@/modules/onemap/OneMapDashboard').then(m => ({ default: m.OneMapDashboard })));
export const NokiaEquipmentDashboard = lazy(() => import('@/modules/nokia-equipment/NokiaEquipmentDashboard').then(m => ({ default: m.NokiaEquipmentDashboard })));

// Project Tracking
export const PoleTrackerDashboard = lazy(() => import('@/modules/projects/pole-tracker/PoleTrackerDashboard').then(m => ({ default: m.PoleTrackerDashboard })));
export const PoleTrackerList = lazy(() => import('@/modules/projects/pole-tracker/PoleTrackerList').then(m => ({ default: m.PoleTrackerList })));
export const UnifiedTrackerGrid = lazy(() => import('@/modules/projects/tracker/UnifiedTrackerGrid').then(m => ({ default: m.UnifiedTrackerGrid })));
export const HomeInstallsDashboard = lazy(() => import('@/modules/projects/home-installs/HomeInstallsDashboard').then(m => ({ default: m.HomeInstallsDashboard })));
export const HomeInstallsList = lazy(() => import('@/modules/projects/home-installs/HomeInstallsList').then(m => ({ default: m.HomeInstallsList })));

// Analytics Module
export const DailyProgressDashboard = lazy(() => import('@/modules/daily-progress/DailyProgressDashboard').then(m => ({ default: m.DailyProgressDashboard })));
export const EnhancedKPIDashboard = lazy(() => import('@/modules/kpis/EnhancedKPIDashboard').then(m => ({ default: m.EnhancedKPIDashboard })));
export const KPIDashboard = lazy(() => import('@/modules/kpi-dashboard/KPIDashboard').then(m => ({ default: m.KPIDashboard })));
export const ReportsDashboard = lazy(() => import('@/modules/reports/ReportsDashboard').then(m => ({ default: m.ReportsDashboard })));

// Contractors Module
export const ContractorsDashboard = lazy(() => import('@/modules/contractors/ContractorsDashboard').then(m => ({ default: m.default })));
export const ContractorCreatePage = lazy(() => import('@/modules/contractors/components/ContractorCreate').then(m => ({ default: m.ContractorCreate })));
export const ContractorEditPage = lazy(() => import('@/modules/contractors/components/ContractorEdit').then(m => ({ default: m.ContractorEdit })));
export const ContractorDetailPage = lazy(() => import('@/modules/contractors/components/ContractorView').then(m => ({ default: m.ContractorView })));
export const AnalyticsDashboard = lazy(() => import('@/components/analytics/AnalyticsDashboard').then(m => ({ default: m.AnalyticsDashboard })));
export const CommunicationsDashboard = lazy(() => import('@/modules/communications/CommunicationsDashboard').then(m => ({ default: m.default })));
export const HelpCenterPage = lazy(() => import('@/modules/help-center/HelpCenterPage').then(m => ({ default: m.HelpCenterPage })));
export const HelpCenterPage = lazy(() => import('@/modules/help-center/HelpCenterPage').then(m => ({ default: m.HelpCenterPage })));
export const HomeInstallationsDashboard = lazy(() => import('@/modules/installations/HomeInstallationsDashboard').then(m => ({ default: m.default })));
export const FieldAppPortal = lazy(() => import('@/modules/field-app/FieldAppPortal').then(m => ({ default: m.default })));
export const FiberStringingDashboard = lazy(() => import('@/modules/projects/fiber-stringing/FiberStringingDashboard').then(m => ({ default: m.FiberStringingDashboard })));
export const DropsManagement = lazy(() => import('@/modules/projects/drops/DropsManagement').then(m => ({ default: m.DropsManagement })));
export const PoleCaptureMobile = lazy(() => import('@/modules/projects/pole-tracker/mobile/PoleCaptureMobile').then(m => ({ default: m.PoleCaptureMobile })));
export const SOWManagement = lazy(() => import('@/modules/projects/sow/SOWManagement').then(m => ({ default: m.SOWManagement })));

// Workflow Module
export const WorkflowPortalPage = lazy(() => import('@/modules/workflow/WorkflowPortalPage'));

// Migration Status
export const MigrationStatus = lazy(() => import('@/pages/MigrationStatus'));

// Project pages
export const Projects = lazy(() => import('@/pages/Projects').then(m => ({ default: m.Projects })));
export const ProjectForm = lazy(() => import('@/pages/ProjectForm').then(m => ({ default: m.ProjectForm })));
export const ProjectDetail = lazy(() => import('@/pages/ProjectDetail').then(m => ({ default: m.ProjectDetail })));
export const Settings = lazy(() => import('@/pages/Settings').then(m => ({ default: m.Settings })));
export const ProjectCreationWizard = lazy(() => import('@/modules/projects/components/ProjectCreationWizard').then(m => ({ default: m.ProjectCreationWizard })));