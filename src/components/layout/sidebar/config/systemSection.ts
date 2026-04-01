/**
 * System section configuration
 */

import { Settings, HeartPulse, Server, Brain, Rocket, Grid3x3, TableProperties, MapPin } from 'lucide-react';
// Hidden items - uncomment when ready: Download, FileDown, Activity, BarChart3
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
      to: '/deployment',
      icon: Rocket,
      label: 'Deployment Health',
      shortLabel: 'Deploy',
      permissions: [Permission.SYSTEM_ADMIN],
      rbacKey: 'system.deployment',
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
      to: '/system/vlm-learning',
      icon: Brain,
      label: 'VLM Learning',
      shortLabel: 'VLM',
      permissions: [Permission.SYSTEM_ADMIN],
      rbacKey: 'system.vlm-learning',
    },
    // Hidden for now - uncomment when ready
    // {
    //   to: XYOPS_URL,
    //   icon: Activity,
    //   label: 'xyOps Monitor',
    //   shortLabel: 'xyOps',
    //   permissions: [Permission.SYSTEM_ADMIN],
    //   rbacKey: 'system',
    //   external: true,
    // },
    // {
    //   to: GRAFANA_URL,
    //   icon: BarChart3,
    //   label: 'Grafana',
    //   shortLabel: 'Grafana',
    //   permissions: [Permission.SYSTEM_ADMIN],
    //   rbacKey: 'system',
    //   external: true,
    // },
    // {
    //   to: '/downloads',
    //   icon: Download,
    //   label: 'Downloads',
    //   shortLabel: 'Downloads',
    //   permissions: [],
    //   rbacKey: 'system.downloads',
    // },
    // {
    //   to: '/imports',
    //   icon: FileDown,
    //   label: 'Imports',
    //   shortLabel: 'Imports',
    //   permissions: [],
    //   rbacKey: 'projects.imports',
    // },
    {
      to: '/devops/schema',
      icon: Grid3x3,
      label: 'Schema Explorer',
      shortLabel: 'Schema',
      permissions: [],
      rbacKey: 'devops.schema',
    },
    {
      to: '/devops/field-mapping',
      icon: TableProperties,
      label: 'Field Mapping',
      shortLabel: 'Mapping',
      permissions: [],
      rbacKey: 'devops.field-mapping',
    },
    {
      to: '/devops/qfield-mapping',
      icon: MapPin,
      label: 'QField Mapping',
      shortLabel: 'QField Map',
      permissions: [],
      rbacKey: 'devops.qfield-mapping',
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