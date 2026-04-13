/**
 * Procurement Dashboard Types
 * Type definitions for dashboard components and data
 */

import type React from 'react';

export interface DashboardCard {
  title: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  link: string;
  description: string;
  permissions?: string[];
}

export interface QuickAction {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  link: string;
  color: string;
  permissions?: string[];
}

export interface RecentActivity {
  id: string;
  type: string;
  action: string;
  item: string;
  timestamp: string;
  status: 'success' | 'warning' | 'error' | 'info';
}

export interface QuickStat {
  label: string;
  value: string;
  color?: string;
}