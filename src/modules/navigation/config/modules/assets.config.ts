/**
 * Assets Module Navigation Config
 * Tab configuration for the Assets module
 */

import {
  LayoutDashboard,
  Package,
  Tags,
  Scan,
  Wrench,
  ClipboardCheck,
} from 'lucide-react';
import type { ModuleNavigationConfig } from '../../types';

export const assetsConfig: ModuleNavigationConfig = {
  moduleId: 'assets',
  moduleName: 'Asset Management',
  description: 'Track, maintain, and manage company assets',
  basePath: '/assets',
  icon: Package,
  tabs: [
    {
      id: 'dashboard',
      label: 'Dashboard',
      shortLabel: 'Home',
      icon: LayoutDashboard,
      path: '/assets',
    },
    {
      id: 'list',
      label: 'All Assets',
      shortLabel: 'Assets',
      icon: Package,
      path: '/assets/list',
      rbacKey: 'assets.list',
    },
    {
      id: 'categories',
      label: 'Categories',
      icon: Tags,
      path: '/assets/categories',
      rbacKey: 'assets.categories',
    },
    {
      id: 'checkout',
      label: 'Check Out / In',
      shortLabel: 'Checkout',
      icon: Scan,
      path: '/assets/checkout',
    },
    {
      id: 'maintenance',
      label: 'Maintenance',
      shortLabel: 'Maint',
      icon: Wrench,
      path: '/assets/maintenance',
      rbacKey: 'assets.maintenance',
    },
    {
      id: 'calibration',
      label: 'Calibration',
      shortLabel: 'Calib',
      icon: ClipboardCheck,
      path: '/assets/calibration',
    },
  ],
};
