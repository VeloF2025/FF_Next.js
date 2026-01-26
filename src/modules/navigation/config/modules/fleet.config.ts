/**
 * Fleet Module Navigation Config
 * Tab configuration for the Fleet module
 */

import {
  BarChart3,
  TrendingUp,
  Users,
  Fuel,
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
    {
      id: 'dashboard',
      label: 'Dashboard',
      shortLabel: 'Home',
      icon: BarChart3,
      path: '/fleet',
    },
    {
      id: 'analytics',
      label: 'Analytics',
      icon: TrendingUp,
      path: '/fleet/analytics',
      rbacKey: 'fleet:analytics:view',
    },
    {
      id: 'drivers',
      label: 'Drivers',
      icon: Users,
      path: '/fleet/drivers',
      rbacKey: 'fleet:drivers:view',
    },
    {
      id: 'fuel',
      label: 'Fuel',
      icon: Fuel,
      path: '/fleet/fuel',
      rbacKey: 'fleet:fuel:view',
    },
    {
      id: 'maintenance',
      label: 'Maintenance',
      shortLabel: 'Maint',
      icon: Wrench,
      path: '/fleet/maintenance',
      rbacKey: 'fleet:maintenance:view',
    },
    {
      id: 'vehicles',
      label: 'Vehicles',
      icon: Car,
      path: '/fleet/vehicles',
      rbacKey: 'fleet:vehicles:view',
    },
    {
      id: 'investigation',
      label: 'GPS Investigation',
      shortLabel: 'GPS',
      icon: FileSearch,
      path: '/fleet/investigation',
      rbacKey: 'fleet:investigation:view',
    },
    {
      id: 'locations',
      label: 'Locations',
      icon: MapPin,
      path: '/fleet/locations',
      rbacKey: 'fleet:locations:view',
    },
    {
      id: 'portal',
      label: 'Portal',
      icon: ScanLine,
      path: '/fleet/portal',
      rbacKey: 'fleet:portal:view',
    },
    {
      id: 'audit',
      label: 'Check-In Audit',
      shortLabel: 'Audit',
      icon: ClipboardList,
      path: '/fleet/check-in/audit',
      rbacKey: 'fleet:audit:view',
    },
  ],
};
