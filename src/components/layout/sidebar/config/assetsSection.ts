/**
 * Assets section configuration
 * Navigation handled via horizontal tabs - see assets.config.ts
 */

import { Package } from 'lucide-react';
import type { NavSection } from './types';

export const assetsSection: NavSection = {
  section: 'Assets',
  sectionId: 'assets',
  sectionLink: '/assets',
  isCollapsible: false,
  items: [
    {
      to: '/assets',
      icon: Package,
      label: 'Assets',
      shortLabel: 'Assets',
      permissions: [],
      rbacKey: 'assets',
    },
  ],
};
