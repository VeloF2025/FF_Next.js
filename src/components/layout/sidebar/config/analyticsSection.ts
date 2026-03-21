/**
 * Analytics & Reporting section configuration
 */

import { Activity, TrendingUp, BarChart3, FileText, LineChart } from 'lucide-react';
import type { NavSection } from './types';

export const analyticsSection: NavSection = {
  section: 'ANALYTICS',
  sectionId: 'analytics',
  isCollapsible: true,
  items: [
    {
      to: '/analytics/reports',
      icon: FileText,
      label: 'Reports',
      shortLabel: 'Reports',
      permissions: [],
      rbacKey: 'analytics.reports',
    },
    {
      to: '/analytics',
      icon: Activity,
      label: 'Analytics Dashboard',
      shortLabel: 'Analytics',
      permissions: [],
      rbacKey: 'analytics.main',
    },
    {
      to: '/enhanced-kpis',
      icon: TrendingUp,
      label: 'Enhanced KPIs',
      shortLabel: 'KPIs',
      permissions: [],
      rbacKey: 'analytics',
    },
    {
      to: '/kpi-dashboard',
      icon: BarChart3,
      label: 'KPI Dashboard',
      shortLabel: 'KPI Dash',
      permissions: [],
      rbacKey: 'analytics',
    },
    {
      to: '/conduit',
      icon: LineChart,
      label: 'Conduit',
      shortLabel: 'Conduit',
      permissions: [],
      rbacKey: 'conduit',
    },
  ]
};