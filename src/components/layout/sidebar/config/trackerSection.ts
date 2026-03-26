/**
 * PON Tracker section configuration
 * Standalone editable tracker — replaces SharePoint Excel trackers
 */

import { Table2 } from 'lucide-react';
import type { NavSection } from './types';

export const trackerSection: NavSection = {
  section: 'PON Tracker',
  sectionId: 'tracker',
  sectionLink: '/tracker',
  isCollapsible: false,
  items: [
    {
      to: '/tracker',
      icon: Table2,
      label: 'PON Tracker',
      shortLabel: 'Tracker',
      permissions: [],
      rbacKey: 'tracker',
    },
  ],
};
