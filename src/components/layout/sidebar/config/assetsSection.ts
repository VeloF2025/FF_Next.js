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
    },
    {
      to: '/assets/list',
      icon: Package,
      label: 'All Assets',
      shortLabel: 'Assets',
      permissions: [],
    },
    {
      to: '/assets/categories',
      icon: Tags,
      label: 'Categories',
      shortLabel: 'Categories',
      permissions: [],
    },
    {
      to: '/assets/checkout',
      icon: Scan,
      label: 'Check Out / In',
      shortLabel: 'Checkout',
      permissions: [],
    },
    {
      to: '/assets/maintenance',
      icon: Wrench,
      label: 'Maintenance',
      shortLabel: 'Maint',
      permissions: [],
    },
    {
      to: '/assets/calibration',
      icon: ClipboardCheck,
      label: 'Calibration',
      shortLabel: 'Calib',
      permissions: [],
    },
  ]
};
