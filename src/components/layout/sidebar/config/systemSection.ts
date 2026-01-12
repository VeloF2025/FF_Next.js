/**
 * System section configuration
 */

import { Settings, Download, FileDown } from 'lucide-react';
import type { NavSection } from './types';

export const systemSection: NavSection = {
  section: 'SYSTEM',
  sectionId: 'system',
  isCollapsible: true,
  items: [
    {
      to: '/downloads',
      icon: Download,
      label: 'Downloads',
      shortLabel: 'Downloads',
      permissions: [],
    },
    {
      to: '/imports',
      icon: FileDown,
      label: 'Imports',
      shortLabel: 'Imports',
      permissions: [],
    },
    {
      to: '/settings',
      icon: Settings,
      label: 'Settings',
      shortLabel: 'Settings',
      permissions: [],
    },
  ]
};