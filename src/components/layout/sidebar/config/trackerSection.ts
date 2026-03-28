/**
 * Project Tracker section configuration
 */

import { Table2 } from 'lucide-react';
import type { NavSection } from './types';

export const trackerSection: NavSection = {
  section: 'Project Tracker',
  sectionId: 'tracker',
  sectionLink: '/tracker',
  isCollapsible: false,
  items: [
    {
      to: '/tracker',
      icon: Table2,
      label: 'Project Tracker',
      shortLabel: 'Tracker',
      permissions: [],
      rbacKey: 'tracker',
    },
  ],
};
