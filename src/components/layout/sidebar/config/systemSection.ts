/**
 * System section configuration
 */

import { Settings, Download, FileDown, Activity, BarChart3 } from 'lucide-react';
import type { NavSection } from './types';
import { Permission } from '@/types/auth.types';

// Server monitoring URLs (Velocity server)
const XYOPS_URL = 'http://100.96.203.105:5522';
const GRAFANA_URL = 'http://100.96.203.105:3030';

export const systemSection: NavSection = {
  section: 'SYSTEM',
  sectionId: 'system',
  isCollapsible: true,
  items: [
    {
      to: XYOPS_URL,
      icon: Activity,
      label: 'xyOps Monitor',
      shortLabel: 'xyOps',
      permissions: [Permission.SYSTEM_ADMIN],
      external: true,
    },
    {
      to: GRAFANA_URL,
      icon: BarChart3,
      label: 'Grafana',
      shortLabel: 'Grafana',
      permissions: [Permission.SYSTEM_ADMIN],
      external: true,
    },
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