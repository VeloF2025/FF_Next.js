/**
 * Analytics Module Navigation Config
 * Tab configuration for the Analytics reports sandbox (restricted internal use)
 */

import { BarChart2 } from 'lucide-react';
import type { ModuleNavigationConfig } from '../../types';

// 🟢 WORKING: Analytics module navigation configuration
export const analyticsConfig: ModuleNavigationConfig = {
  moduleId: 'analytics',
  moduleName: 'Analytics',
  description: 'Analytics and reporting — restricted internal use',
  basePath: '/analytics',
  icon: BarChart2,
  tabs: [
    {
      id: 'reports',
      label: 'Reports',
      icon: BarChart2,
      path: '/analytics/reports',
      rbacKey: 'analytics.reports',
    },
  ],
};
