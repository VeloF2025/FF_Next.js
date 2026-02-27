/**
 * Field Operations section configuration
 *
 * Single entry point — sub-navigation handled via horizontal tabs at the top of the page.
 * Currently only Civil QA (Construction QA); more items can be added as tabs.
 */

import { HardHat } from 'lucide-react';
import type { NavSection } from './types';

export const fieldOperationsSection: NavSection = {
  section: 'Field Operations',
  sectionId: 'field-ops',
  sectionLink: '/field-ops',
  isCollapsible: false,
  items: [
    {
      to: '/field-ops',
      icon: HardHat,
      label: 'Field Operations',
      shortLabel: 'Field Ops',
      permissions: [],
      rbacKey: 'field',
    },
  ],
};