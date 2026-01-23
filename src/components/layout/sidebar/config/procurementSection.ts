/**
 * Procurement & Inventory section configuration
 *
 * Simplified flat navigation with tab-based content pages:
 * - Dashboard: Overview with workflow stepper
 * - Sourcing: Suppliers, BOQ, RFQ (tabs)
 * - Purchasing: Quotes, Requisitions, POs, GRN (tabs)
 * - Inventory: Stock, Items, Categories, Bundles, Takes, Field (tabs)
 * - Financial: Budget, Cost Centers (tabs)
 * - Approvals: Approval workflow
 */

import {
  LayoutDashboard,
  CheckCircle,
  ShoppingCart,
  FileText,
  Warehouse,
  DollarSign,
} from 'lucide-react';
import type { NavSection } from './types';

export const procurementSection: NavSection = {
  section: 'PROCUREMENT',
  sectionId: 'procurement',
  isCollapsible: true,
  items: [
    // Dashboard - Overview with workflow stepper
    {
      to: '/procurement',
      icon: LayoutDashboard,
      label: 'Dashboard',
      shortLabel: 'Dash',
      permissions: [],
      rbacKey: 'procurement.main',
    },

    // Sourcing - Pre-purchase activities (tabs: Suppliers, BOQ, RFQ)
    {
      to: '/procurement/sourcing',
      icon: ShoppingCart,
      label: 'Sourcing',
      shortLabel: 'Source',
      permissions: [],
      rbacKey: 'procurement.sourcing',
    },

    // Purchasing - Transaction workflow (tabs: Quotes, Requisitions, PO, GRN)
    {
      to: '/procurement/purchasing',
      icon: FileText,
      label: 'Purchasing',
      shortLabel: 'Purchase',
      permissions: [],
      rbacKey: 'procurement.purchasing',
    },

    // Inventory - Stock management (tabs: Stock, Items, Categories, Bundles, Takes, Field)
    {
      to: '/procurement/inventory',
      icon: Warehouse,
      label: 'Inventory',
      shortLabel: 'Stock',
      permissions: [],
      rbacKey: 'procurement.inventory',
    },

    // Financial - Budget and cost tracking (tabs: Budget, Cost Centers)
    {
      to: '/procurement/financial',
      icon: DollarSign,
      label: 'Financial',
      shortLabel: 'Finance',
      permissions: [],
      rbacKey: 'procurement', // Module-level for now
    },

    // Approvals - Cross-cutting workflow gate
    {
      to: '/procurement/approvals',
      icon: CheckCircle,
      label: 'Approvals',
      shortLabel: 'Approve',
      permissions: [],
      rbacKey: 'procurement.approvals',
    },
  ]
};
