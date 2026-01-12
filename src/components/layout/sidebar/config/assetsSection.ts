/**
 * Assets section configuration
 */

import {
  Package,
  LayoutDashboard,
  Scan,
  Wrench,
  ClipboardCheck,
  Tags,
  History
} from 'lucide-react';
import type { NavSection } from './types';

export const assetsSection: NavSection = {
  section: 'ASSETS',
  sectionId: 'assets',
  isCollapsible: true,
  items: [
    {
      to: '/inventory',
      icon: LayoutDashboard,
      label: 'Asset Dashboard',
      shortLabel: 'Dashboard',
      permissions: [],
    },
    {
      to: '/inventory/list',
      icon: Package,
      label: 'All Assets',
      shortLabel: 'Assets',
      permissions: [],
    },
    {
      to: '/inventory/categories',
      icon: Tags,
      label: 'Categories',
      shortLabel: 'Categories',
      permissions: [],
    },
    {
      to: '/inventory/checkout',
      icon: Scan,
      label: 'Check Out / In',
      shortLabel: 'Checkout',
      permissions: [],
    },
    {
      to: '/inventory/maintenance',
      icon: Wrench,
      label: 'Maintenance',
      shortLabel: 'Maint',
      permissions: [],
    },
    {
      to: '/inventory/calibration',
      icon: ClipboardCheck,
      label: 'Calibration',
      shortLabel: 'Calib',
      permissions: [],
    },
  ]
};
