/**
 * Activate Module Navigation Configuration
 *
 * Provides tab-based navigation for the Activate module:
 * - Dashboard: Overview stats and project breakdown
 * - QA Centre: DR list for quality assurance review
 * - Reports: Analytics and reporting dashboards
 */

import { LayoutDashboard, ClipboardCheck, BarChart3 } from 'lucide-react';
import type { ModuleNavigationConfig } from '../../types';

export const activateConfig: ModuleNavigationConfig = {
  moduleId: 'activate',
  moduleName: 'Activate',
  description: 'DR photo QA and activation management',
  basePath: '/activate',
  icon: ClipboardCheck,
  tabs: [
    {
      id: 'dashboard',
      label: 'Dashboard',
      shortLabel: 'Home',
      icon: LayoutDashboard,
      path: '/activate',
      rbacKey: 'activate.main',
    },
    {
      id: 'qa-centre',
      label: 'QA Centre',
      shortLabel: 'QA',
      icon: ClipboardCheck,
      path: '/activate/qa-centre',
      rbacKey: 'activate.qa-centre',
    },
    {
      id: 'reports',
      label: 'Reports',
      shortLabel: 'Reports',
      icon: BarChart3,
      path: '/activate/reports',
      rbacKey: 'activate.reports',
    },
  ],
};
