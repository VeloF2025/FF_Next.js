/**
 * Procurement & Inventory section configuration
 *
 * Single entry point - all navigation handled via horizontal tabs
 * within the module using ModulePage component.
 * Also contains a direct link to the mobile-first Stock Portal.
 */

import { Package, ShoppingCart } from 'lucide-react';
import type { NavSection } from './types';

export const procurementSection: NavSection = {
  section: 'Procurement',
  sectionId: 'procurement',
  sectionLink: '/procurement',
  isCollapsible: false,
  items: [
    {
      to: '/procurement',
      icon: ShoppingCart,
      label: 'Procurement',
      shortLabel: 'Procure',
      permissions: [],
      rbacKey: 'procurement',
    },
    {
      to: '/stock/portal',
      icon: Package,
      label: 'Stock Portal',
      shortLabel: 'Stock',
      permissions: [],
      rbacKey: 'procurement.inventory',
    },
  ],
};
