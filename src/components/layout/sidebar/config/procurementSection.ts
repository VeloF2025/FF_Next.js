/**
 * Procurement & Inventory section configuration
 *
 * Organized by workflow:
 * - Overview: Dashboard
 * - Sourcing: Suppliers, BOQ, RFQ
 * - Purchasing: Requisitions, POs, GRN, Approvals
 * - Inventory: Stock Items, Stock Movement, Field Stock
 */

import {
  LayoutDashboard,
  Truck,
  FileSpreadsheet,
  FileQuestion,
  ClipboardList,
  FileText,
  PackageCheck,
  CheckCircle,
  Boxes,
  ArrowLeftRight,
  Package,
} from 'lucide-react';
import type { NavSection } from './types';

export const procurementSection: NavSection = {
  section: 'PROCUREMENT & INVENTORY',
  sectionId: 'procurement',
  isCollapsible: true,
  items: [
    // Overview
    {
      to: '/procurement',
      icon: LayoutDashboard,
      label: 'Dashboard',
      shortLabel: 'Dash',
      permissions: []
    },

    // Sourcing
    {
      to: '/suppliers',
      icon: Truck,
      label: 'Suppliers',
      shortLabel: 'Supply',
      permissions: []
    },
    {
      to: '/procurement/boq',
      icon: FileSpreadsheet,
      label: 'Bill of Quantities',
      shortLabel: 'BOQ',
      permissions: []
    },
    {
      to: '/procurement/rfq',
      icon: FileQuestion,
      label: 'Request for Quote',
      shortLabel: 'RFQ',
      permissions: []
    },

    // Purchasing
    {
      to: '/procurement/requisitions',
      icon: ClipboardList,
      label: 'Requisitions',
      shortLabel: 'Req',
      permissions: []
    },
    {
      to: '/procurement/purchase-orders',
      icon: FileText,
      label: 'Purchase Orders',
      shortLabel: 'PO',
      permissions: []
    },
    {
      to: '/procurement/grn',
      icon: PackageCheck,
      label: 'Goods Receipt',
      shortLabel: 'GRN',
      permissions: []
    },
    {
      to: '/procurement/approvals',
      icon: CheckCircle,
      label: 'Approvals',
      shortLabel: 'Approve',
      permissions: []
    },

    // Inventory
    {
      to: '/procurement/stock-items',
      icon: Boxes,
      label: 'Stock Items',
      shortLabel: 'Stock',
      permissions: []
    },
    {
      to: '/procurement/stock',
      icon: ArrowLeftRight,
      label: 'Stock Movement',
      shortLabel: 'Move',
      permissions: []
    },
    {
      to: '/procurement/field-stock',
      icon: Package,
      label: 'Field Stock',
      shortLabel: 'Field',
      permissions: []
    },
  ]
};
