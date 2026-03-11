/**
 * NOC (Network Operations Centre) navigation section configuration
 *
 * Sub-navigation is handled by horizontal tabs at the top of the page.
 * This section only contains the main entry point to the NOC module.
 */

import { Wrench } from 'lucide-react';
import type { NavSection } from './types';

export const nocSection: NavSection = {
  section: 'NOC',
  sectionId: 'noc',
  sectionLink: '/noc',
  isCollapsible: false,
  items: [
    {
      to: '/noc',
      icon: Wrench,
      label: 'NOC',
      shortLabel: 'NOC',
      permissions: [],
      rbacKey: 'noc.main',
    },
  ]
};
