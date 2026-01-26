/**
 * Activate Module Navigation Configuration
 *
 * Provides tab-based navigation for the Activate module:
 * - Dashboard: DR photo review and activation overview
 * - QA Centre: Quality assurance workflow
 */

import { LayoutDashboard, ClipboardCheck } from 'lucide-react';
import type { ModuleNavigationConfig } from '../types';

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
  ],
};
