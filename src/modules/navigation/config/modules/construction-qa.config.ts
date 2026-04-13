/**
 * Construction QA Module Navigation Configuration
 *
 * Provides tab-based navigation for the Construction QA module:
 * - QA Centre: Feature list for quality assurance review (civil and optical)
 * - Reports: Construction-specific analytics and reporting
 */

import { HardHat, ClipboardCheck, BarChart3, Radio, AlertTriangle, LayoutGrid, List, Table2 } from 'lucide-react';
import type { ModuleNavigationConfig } from '../../types';

export const constructionQaConfig: ModuleNavigationConfig = {
  moduleId: 'construction-qa',
  moduleName: 'Civil QA',
  description: 'Civil and optical quality assurance',
  basePath: '/field-ops',
  icon: HardHat,
  tabs: [
    {
      id: 'qa-centre',
      label: 'QA Centre',
      shortLabel: 'QA',
      icon: ClipboardCheck,
      path: '/field-ops',
      rbacKey: 'construction-qa.qa-centre',
    },
    {
      id: 'otdr-testing',
      label: 'OTDR Testing',
      shortLabel: 'OTDR',
      icon: Radio,
      path: '/field-ops/otdr',
      rbacKey: 'construction-qa.otdr',
    },
    {
      id: 'snags',
      label: 'Snags',
      shortLabel: 'Snags',
      icon: AlertTriangle,
      path: '/field-ops/snags',
      rbacKey: 'construction-qa.snags',
      subTabs: [
        { id: 'cards', label: 'Cards', icon: LayoutGrid, path: '/field-ops/snags' },
        { id: 'list', label: 'List', icon: List, path: '/field-ops/snags/list' },
        { id: 'summary', label: 'Summary', icon: Table2, path: '/field-ops/snags/summary' },
        { id: 'reports', label: 'Reports', icon: BarChart3, path: '/field-ops/snags/reports' },
      ],
    },
    {
      id: 'reports',
      label: 'Reports',
      shortLabel: 'Reports',
      icon: BarChart3,
      path: '/field-ops/reports',
      rbacKey: 'construction-qa.reports',
    },
  ],
};
