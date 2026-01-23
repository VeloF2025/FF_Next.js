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
      to: '/assets',
      icon: LayoutDashboard,
      label: 'Asset Dashboard',
      shortLabel: 'Dashboard',
      permissions: [],
      rbacKey: 'assets',
    },
    {
      to: '/assets/list',
      icon: Package,
      label: 'All Assets',
      shortLabel: 'Assets',
      permissions: [],
      rbacKey: 'assets.list',
    },
    {
      to: '/assets/categories',
      icon: Tags,
      label: 'Categories',
      shortLabel: 'Categories',
      permissions: [],
      rbacKey: 'assets.categories',
    },
    {
      to: '/assets/checkout',
      icon: Scan,
      label: 'Check Out / In',
      shortLabel: 'Checkout',
      permissions: [],
      rbacKey: 'assets',
    },
    {
      to: '/assets/maintenance',
      icon: Wrench,
      label: 'Maintenance',
      shortLabel: 'Maint',
      permissions: [],
      rbacKey: 'assets.maintenance',
    },
    {
      to: '/assets/calibration',
      icon: ClipboardCheck,
      label: 'Calibration',
      shortLabel: 'Calib',
      permissions: [],
      rbacKey: 'assets',
    },
  ]
};
