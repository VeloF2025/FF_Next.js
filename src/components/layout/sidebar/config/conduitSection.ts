/**
 * Conduit section configuration
 * Project financial scoping tool — sits below Field Operations
 */

import { LineChart } from 'lucide-react';
import type { NavSection } from './types';

export const conduitSection: NavSection = {
  section: 'Conduit',
  sectionId: 'conduit',
  sectionLink: '/conduit',
  isCollapsible: false,
  items: [
    {
      to: '/conduit',
      icon: LineChart,
      label: 'Conduit',
      shortLabel: 'Conduit',
      permissions: [],
      rbacKey: 'conduit',
    },
  ],
};
