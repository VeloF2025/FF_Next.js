/**
 * Clients section configuration
 */

import { Building2 } from 'lucide-react';
import type { NavSection } from './types';

export const clientsSection: NavSection = {
  section: 'CLIENTS',
  sectionId: 'clients',
  isCollapsible: true,
  items: [
    {
      to: '/clients',
      icon: Building2,
      label: 'Clients',
      shortLabel: 'Clients',
      permissions: [],
      rbacKey: 'clients.list',
    },
  ]
};
