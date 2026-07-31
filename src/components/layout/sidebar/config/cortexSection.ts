/**
 * Cortex section configuration
 */

import { Brain, Cable } from 'lucide-react';
import type { NavSection } from './types';

export const cortexSection: NavSection = {
  section: 'CORTEX',
  sectionId: 'cortex',
  isCollapsible: true,
  items: [
    {
      to: '/cortex',
      icon: Brain,
      label: 'Cortex',
      shortLabel: 'Cortex',
      rbacKey: 'cortex.review',
      permissions: [],
    },
    {
      to: '/connections/fibreflow',
      icon: Cable,
      label: 'AI Connections',
      shortLabel: 'Connections',
      rbacKey: 'cortex.review',
      permissions: [],
    },
  ],
};
