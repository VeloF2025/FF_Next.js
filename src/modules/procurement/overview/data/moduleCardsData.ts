// ============= Module Cards Configuration =============

import {
  Package,
  FileText,
  Send,
  ShoppingCart,
  Truck,
  Quote,
  ClipboardList,
  TrendingUp,
  Users,
  CheckCircle,
  Activity,
  ArrowRight
} from 'lucide-react';
import type { ModuleCard, ProjectStats } from '../types/types';
import type { NavigateFunction } from 'react-router-dom';

export const getModuleCards = (stats: ProjectStats, navigate: NavigateFunction): ModuleCard[] => [
  {
    id: 'boq',
    title: 'BOQ Management',
    description: 'Excel import, catalog mapping, and demand management',
    icon: FileText,
    color: 'bg-blue-500',
    href: '/app/procurement/boq',
    targetTab: 'boq',
    permission: 'buyer',
    metrics: [
      { label: 'Total BOQs', value: stats.boq.total, format: 'number' },
      { label: 'Draft', value: stats.boq.draft, format: 'number', status: 'warning' },
      { label: 'Approved', value: stats.boq.approved, format: 'number', status: 'success' },
      { label: 'Total Value', value: stats.boq.totalValue, format: 'currency' }
    ],
    quickActions: [
      { label: 'Import Excel', icon: FileText, onClick: () => navigate('/app/procurement/boq/import') },
      { label: 'Create BOQ', icon: FileText, onClick: () => navigate('/app/procurement/boq/new') }
    ]
  },
  {
    id: 'rfq',
    title: 'RFQ Management',
    description: 'Multi-supplier invitations, Q&A, and deadline tracking',
    icon: Send,
    color: 'bg-green-500',
    href: '/app/procurement/rfq',
    targetTab: 'rfq',
    permission: 'buyer',
    metrics: [
      { label: 'Active RFQs', value: stats.rfq.sent, format: 'number', status: 'info' },
      { label: 'Responses', value: stats.rfq.responsesReceived, format: 'number' },
      { label: 'Awarded', value: stats.rfq.awarded, format: 'number', status: 'success' },
      { label: 'Pending', value: stats.rfq.total - stats.rfq.awarded, format: 'number', status: 'warning' }
    ],
    quickActions: [
      { label: 'New RFQ', icon: Send, onClick: () => navigate('/app/procurement/rfq/new') },
      { label: 'Review Responses', icon: Activity, onClick: () => navigate('/app/procurement/rfq/responses') }
    ]
  },
  {
    id: 'quotes',
    title: 'Quote Evaluation',
    description: 'Compare prices, technical approval, and split awards',
    icon: Quote,
    color: 'bg-purple-500',
    href: '/app/procurement/quotes',
    targetTab: 'quotes',
    permission: 'buyer',
    metrics: [
      { label: 'Received', value: 0, format: 'number' },
      { label: 'Under Review', value: 0, format: 'number', status: 'warning' },
      { label: 'Approved', value: 0, format: 'number', status: 'success' },
      { label: 'Avg Savings', value: 0, format: 'percentage', status: 'success' }
    ],
    quickActions: [
      { label: 'Compare Quotes', icon: TrendingUp, onClick: () => navigate('/app/procurement/quotes/compare') },
      { label: 'Award Split', icon: CheckCircle, onClick: () => navigate('/app/procurement/quotes/award') }
    ]
  },
  {
    id: 'purchase-orders',
    title: 'Purchase Orders',
    description: 'PO generation, budget checks, and approval workflows',
    icon: ShoppingCart,
    color: 'bg-orange-500',
    href: '/app/procurement/orders',
    targetTab: 'purchase-orders',
    permission: 'buyer',
    metrics: [
      { label: 'Active POs', value: 0, format: 'number' },
      { label: 'Pending Approval', value: 0, format: 'number', status: 'warning' },
      { label: 'This Month', value: 0, format: 'currency' },
      { label: 'Budget Used', value: 0, format: 'percentage', status: 'info' }
    ],
    quickActions: [
      { label: 'Create PO', icon: ShoppingCart, onClick: () => navigate('/app/procurement/orders/new') },
      { label: 'Approve Pending', icon: CheckCircle, onClick: () => navigate('/app/procurement/orders/approve') }
    ]
  },
  {
    id: 'stock',
    title: 'Stock Management',
    description: 'ASN, GRN, cable tracking, and inter-project transfers',
    icon: Package,
    color: 'bg-indigo-500',
    href: '/app/procurement/stock',
    targetTab: 'stock',
    permission: 'store-controller',
    metrics: [
      { label: 'Total Items', value: 0, format: 'number' },
      { label: 'Low Stock', value: 0, format: 'number', status: 'error' },
      { label: 'Cable Drums', value: 0, format: 'number' },
      { label: 'Pending GRN', value: 0, format: 'number', status: 'warning' }
    ],
    quickActions: [
      { label: 'Receive Stock', icon: Package, onClick: () => navigate('/app/procurement/stock/receive') },
      { label: 'Transfer Items', icon: ArrowRight, onClick: () => navigate('/app/procurement/stock/transfer') }
    ]
  },
  {
    id: 'suppliers',
    title: 'Supplier Portal',
    description: 'Invitations, access control, and performance tracking',
    icon: Truck,
    color: 'bg-teal-500',
    href: '/app/procurement/suppliers',
    targetTab: 'suppliers',
    permission: 'buyer',
    metrics: [
      { label: 'Active Suppliers', value: 0, format: 'number' },
      { label: 'OTIF Score', value: 0, format: 'percentage', status: 'success' },
      { label: 'New This Month', value: 0, format: 'number', status: 'info' },
      { label: 'Performance Issues', value: 0, format: 'number', status: 'warning' }
    ],
    quickActions: [
      { label: 'Invite Supplier', icon: Users, onClick: () => navigate('/app/procurement/suppliers/invite') },
      { label: 'Performance Report', icon: TrendingUp, onClick: () => navigate('/app/procurement/suppliers/performance') }
    ]
  },
  {
    id: 'reports',
    title: 'Reports & Analytics',
    description: 'Project reports, savings analysis, and cycle time metrics',
    icon: ClipboardList,
    color: 'bg-pink-500',
    href: '/app/procurement/reports',
    targetTab: 'reports',
    permission: 'viewer',
    metrics: [
      { label: 'Reports Generated', value: 0, format: 'number' },
      { label: 'Cost Savings', value: 0, format: 'currency', status: 'success' },
      { label: 'Cycle Time', value: 0, format: 'number', status: 'info' },
      { label: 'Budget Variance', value: 0, format: 'percentage', status: 'success' }
    ],
    quickActions: [
      { label: 'Generate Report', icon: ClipboardList, onClick: () => navigate('/app/procurement/reports/generate') },
      { label: 'Analytics Dashboard', icon: TrendingUp, onClick: () => navigate('/app/procurement/reports/analytics') }
    ]
  }
];
