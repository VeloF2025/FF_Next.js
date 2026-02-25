/**
 * Construction QA Module Navigation Configuration
 *
 * Provides tab-based navigation for the Construction QA module:
 * - QA Centre: Feature list for quality assurance review (civil, optical, splicing)
 * - Reports: Construction-specific analytics and reporting
 */

import { HardHat, ClipboardCheck, BarChart3, Radio } from 'lucide-react';
import type { ModuleNavigationConfig } from '../../types';

export const constructionQaConfig: ModuleNavigationConfig = {
  moduleId: 'construction-qa',
  moduleName: 'Civil QA',
  description: 'Civil, optical, and splicing quality assurance',
  basePath: '/construction-qa',
  icon: HardHat,
  tabs: [
    {
      id: 'qa-centre',
      label: 'QA Centre',
      shortLabel: 'QA',
      icon: ClipboardCheck,
      path: '/construction-qa',
      rbacKey: 'field',
    },
    {
      id: 'otdr-testing',
      label: 'OTDR Testing',
      shortLabel: 'OTDR',
      icon: Radio,
      path: '/construction-qa/otdr',
      rbacKey: 'field',
    },
    {
      id: 'reports',
      label: 'Reports',
      shortLabel: 'Reports',
      icon: BarChart3,
      path: '/construction-qa/reports',
      rbacKey: 'field',
    },
  ],
};
