/**
 * System section configuration
 */

import { Settings, Download, FileDown, Activity, BarChart3, HeartPulse, Server, Database } from 'lucide-react';
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
      to: '/system/health',
      icon: HeartPulse,
      label: 'System Health Hub',
      shortLabel: 'Health',
      permissions: [Permission.SYSTEM_ADMIN],
      rbacKey: 'system.health',
    },
    {
      to: '/system/infrastructure',
      icon: Server,
      label: 'Infrastructure',
      shortLabel: 'Infra',
      permissions: [Permission.SYSTEM_ADMIN],
      rbacKey: 'system', // Admin-only via RBAC
    },
    {
      to: '/system/data-sync',
      icon: Database,
      label: 'Data Sync',
      shortLabel: 'Sync',
      permissions: [Permission.SYSTEM_ADMIN],
      rbacKey: 'system.data-sync',
    },
    {
      to: XYOPS_URL,
      icon: Activity,
      label: 'xyOps Monitor',
      shortLabel: 'xyOps',
      permissions: [Permission.SYSTEM_ADMIN],
      rbacKey: 'system', // Admin-only via RBAC
      external: true,
    },
    {
      to: GRAFANA_URL,
      icon: BarChart3,
      label: 'Grafana',
      shortLabel: 'Grafana',
      permissions: [Permission.SYSTEM_ADMIN],
      rbacKey: 'system', // Admin-only via RBAC
      external: true,
    },
    {
      to: '/downloads',
      icon: Download,
      label: 'Downloads',
      shortLabel: 'Downloads',
      permissions: [],
      rbacKey: 'system.downloads',
    },
    {
      to: '/imports',
      icon: FileDown,
      label: 'Imports',
      shortLabel: 'Imports',
      permissions: [],
      rbacKey: 'projects.imports',
    },
    {
      to: '/settings',
      icon: Settings,
      label: 'Settings',
      shortLabel: 'Settings',
      permissions: [],
      rbacKey: 'system.settings',
    },
  ]
};