/**
 * Procurement Module Navigation Configuration
 *
 * Provides tab-based navigation for the Procurement module:
 * - Dashboard: Overview with workflow stepper
 * - Sourcing: Suppliers, BOQ, RFQ
 * - Purchasing: Requisitions, Quotes, POs, GRN
 * - Inventory: Stock management
 * - Financial: Budget and cost tracking
 * - Approvals: Approval workflow
 */

import {
  LayoutDashboard,
  ShoppingCart,
  FileText,
  Warehouse,
  DollarSign,
  CheckCircle,
} from 'lucide-react';
import type { ModuleNavigationConfig } from '../../types';

export const procurementConfig: ModuleNavigationConfig = {
  moduleId: 'procurement',
  moduleName: 'Procurement & Inventory',
  description: 'Manage purchasing, inventory, and approvals',
  basePath: '/procurement',
  icon: ShoppingCart,
  tabs: [
    {
      id: 'dashboard',
      label: 'Dashboard',
      shortLabel: 'Home',
      icon: LayoutDashboard,
      path: '/procurement',
      rbacKey: 'procurement.main',
    },
    {
      id: 'sourcing',
      label: 'Sourcing',
      shortLabel: 'Source',
      icon: ShoppingCart,
      path: '/procurement/sourcing',
      rbacKey: 'procurement.sourcing',
    },
    {
      id: 'purchasing',
      label: 'Purchasing',
      shortLabel: 'Purchase',
      icon: FileText,
      path: '/procurement/purchasing',
      rbacKey: 'procurement.purchasing',
    },
    {
      id: 'inventory',
      label: 'Inventory',
      shortLabel: 'Stock',
      icon: Warehouse,
      path: '/procurement/inventory',
      rbacKey: 'procurement.inventory',
    },
    {
      id: 'financial',
      label: 'Financial',
      shortLabel: 'Finance',
      icon: DollarSign,
      path: '/procurement/financial',
      rbacKey: 'procurement',
    },
    {
      id: 'approvals',
      label: 'Approvals',
      shortLabel: 'Approve',
      icon: CheckCircle,
      path: '/procurement/approvals',
      rbacKey: 'procurement.approvals',
    },
  ],
};
