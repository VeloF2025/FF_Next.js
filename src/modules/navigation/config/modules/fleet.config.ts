/**
 * Fleet Module Navigation Config
 * Tab configuration for the Fleet module
 */

import {
  BarChart3,
  TrendingUp,
  Users,
  Fuel,
  Gauge,
  Wrench,
  Car,
  FileSearch,
  MapPin,
  ScanLine,
  ClipboardList,
} from 'lucide-react';
import type { ModuleNavigationConfig } from '../../types';

export const fleetConfig: ModuleNavigationConfig = {
  moduleId: 'fleet',
  moduleName: 'Fleet Management',
  description: 'Vehicle management, GPS investigation, and fleet analytics',
  basePath: '/fleet',
  icon: Car,
  tabs: [
    // Core assets
    {
      id: 'dashboard',
      label: 'Dashboard',
      shortLabel: 'Home',
      icon: BarChart3,
      path: '/fleet',
    },
    {
      id: 'vehicles',
      label: 'Vehicles',
      icon: Car,
      path: '/fleet/vehicles',
      rbacKey: 'fleet.vehicles',
    },
    {
      id: 'drivers',
      label: 'Drivers',
      icon: Users,
      path: '/fleet/drivers',
      rbacKey: 'fleet.drivers',
    },
    // GPS & Location tracking
    {
      id: 'investigation',
      label: 'GPS Investigation',
      shortLabel: 'GPS',
      icon: FileSearch,
      path: '/fleet/investigation',
      rbacKey: 'fleet.investigation',
    },
    {
      id: 'locations',
      label: 'Locations',
      icon: MapPin,
      path: '/fleet/locations',
      rbacKey: 'fleet.locations',
    },
    // Operations
    {
      id: 'fuel',
      label: 'Fuel',
      icon: Fuel,
      path: '/fleet/fuel',
      rbacKey: 'fleet.fuel',
    },
    {
      id: 'mileage',
      label: 'Mileage',
      icon: Gauge,
      path: '/fleet/mileage',
      rbacKey: 'fleet.mileage',
    },
    {
      id: 'maintenance',
      label: 'Maintenance',
      shortLabel: 'Maint',
      icon: Wrench,
      path: '/fleet/maintenance',
      rbacKey: 'fleet.maintenance',
    },
    // Reporting & Admin
    {
      id: 'analytics',
      label: 'Analytics',
      icon: TrendingUp,
      path: '/fleet/analytics',
      rbacKey: 'fleet.analytics',
    },
    {
      id: 'portal',
      label: 'Portal',
      icon: ScanLine,
      path: '/fleet/portal',
      rbacKey: 'fleet.portal',
    },
    {
      id: 'check-in-history',
      label: 'Check-Ins',
      shortLabel: 'Check-Ins',
      icon: ClipboardList,
      path: '/fleet/check-in/history',
      rbacKey: 'fleet.check-in-audit',
    },
  ],
};
