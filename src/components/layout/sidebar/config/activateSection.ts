/**
 * Activate section configuration
 * Single entry point - all navigation handled via horizontal tabs
 */

import { ClipboardCheck } from 'lucide-react';
import type { NavSection } from './types';

export const activateSection: NavSection = {
  section: 'Activate',
  sectionId: 'activate',
  sectionLink: '/activate',
  isCollapsible: false,
  items: [
    {
      to: '/activate',
      icon: ClipboardCheck,
      label: 'Activate',
      shortLabel: 'Activate',
      permissions: [],
      rbacKey: 'activate',
    },
  ],
};
