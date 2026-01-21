/**
 * Procurement & Inventory section configuration
 *
 * Organized by workflow with collapsible groups:
 * - Dashboard: Overview with workflow stepper
 * - Sourcing: Suppliers, BOQ, RFQ (pre-purchase)
 * - Purchasing: Quotes, Requisitions, POs, GRN (transaction workflow)
 * - Inventory: Stock management (what we have)
 * - Financial: Budget and cost tracking
 * - Approvals: Cross-cutting workflow gate
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
  FolderTree,
  PackagePlus,
  ClipboardCheck,
  Building2,
  Wallet,
  Scale,
  ShoppingCart,
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
      permissions: []
    },

    // Sourcing Group - Pre-purchase activities
    {
      to: '#sourcing',
      icon: ShoppingCart,
      label: 'Sourcing',
      shortLabel: 'Source',
      permissions: [],
      isGroup: true,
      subItems: [
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
      ]
    },

    // Purchasing Group - Transaction workflow
    {
      to: '#purchasing',
      icon: FileText,
      label: 'Purchasing',
      shortLabel: 'Purchase',
      permissions: [],
      isGroup: true,
      subItems: [
        {
          to: '/procurement/quotes',
          icon: Scale,
          label: 'Quotes',
          shortLabel: 'Quotes',
          permissions: []
        },
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
      ]
    },

    // Inventory Group - Stock management
    {
      to: '#inventory',
      icon: Warehouse,
      label: 'Inventory',
      shortLabel: 'Stock',
      permissions: [],
      isGroup: true,
      subItems: [
        {
          to: '/procurement/stock-categories',
          icon: FolderTree,
          label: 'Stock Categories',
          shortLabel: 'Cats',
          permissions: []
        },
        {
          to: '/procurement/stock-items',
          icon: Boxes,
          label: 'Stock Items',
          shortLabel: 'Stock',
          permissions: []
        },
        {
          to: '/procurement/bundles',
          icon: PackagePlus,
          label: 'Bundles / Kits',
          shortLabel: 'Kits',
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
          to: '/procurement/stock-takes',
          icon: ClipboardCheck,
          label: 'Stock Takes',
          shortLabel: 'Count',
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
    },

    // Financial Group - Budget and cost tracking
    {
      to: '#financial',
      icon: DollarSign,
      label: 'Financial',
      shortLabel: 'Finance',
      permissions: [],
      isGroup: true,
      subItems: [
        {
          to: '/procurement/budget',
          icon: Wallet,
          label: 'Budget Overview',
          shortLabel: 'Budget',
          permissions: []
        },
        {
          to: '/procurement/cost-centers',
          icon: Building2,
          label: 'Cost Centers',
          shortLabel: 'Costs',
          permissions: []
        },
      ]
    },

    // Approvals - Cross-cutting, always visible
    {
      to: '/procurement/approvals',
      icon: CheckCircle,
      label: 'Approvals',
      shortLabel: 'Approve',
      permissions: []
    },
  ]
};
