/**
 * Maintenance navigation section configuration
 *
 * Sub-navigation is handled by horizontal tabs at the top of the page.
 * This section only contains the main entry point to the Maintenance module.
 */

import { Wrench } from 'lucide-react';
import type { NavSection } from './types';

export const maintenanceSection: NavSection = {
  section: 'MAINTENANCE',
  sectionId: 'maintenance',
  isCollapsible: false,
  items: [
    {
      to: '/maintenance',
      icon: Wrench,
      label: 'Maintenance',
      shortLabel: 'Maint',
      permissions: [],
      rbacKey: 'maintenance.main',
    },
  ]
};
