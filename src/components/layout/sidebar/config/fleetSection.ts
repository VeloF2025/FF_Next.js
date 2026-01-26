/**
 * Fleet section configuration
 *
 * Sub-navigation is handled by horizontal tabs at the top of the page.
 * This section only contains the main entry point to the Fleet module.
 */

import { Car } from 'lucide-react';
import type { NavSection } from './types';

export const fleetSection: NavSection = {
  section: 'FLEET',
  sectionId: 'fleet',
  isCollapsible: false,
  items: [
    {
      to: '/fleet',
      icon: Car,
      label: 'Fleet Management',
      shortLabel: 'Fleet',
      permissions: [],
      rbacKey: 'fleet.main',
    },
  ],
};
