/**
 * Fleet section configuration
 * Vehicle management, GPS investigation, and fleet analytics
 */

import {
  Truck,
  Car,
  MapPin,
  FileSearch,
  BarChart3,
  ScanLine,
  TrendingUp,
  Wrench,
  Users,
  Fuel,
  Trophy,
  ClipboardList,
} from 'lucide-react';
import type { NavSection } from './types';

export const fleetSection: NavSection = {
  section: 'FLEET',
  sectionId: 'fleet',
  isCollapsible: true,
  items: [
    {
      to: '/fleet',
      icon: BarChart3,
      label: 'Fleet Dashboard',
      shortLabel: 'Dashboard',
      permissions: [],
    },
    {
      to: '/fleet/analytics',
      icon: TrendingUp,
      label: 'Fleet Analytics',
      shortLabel: 'Analytics',
      permissions: [],
    },
    {
      to: '/fleet/drivers',
      icon: Users,
      label: 'Fleet Drivers',
      shortLabel: 'Drivers',
      permissions: [],
    },
    {
      to: '/fleet/fuel',
      icon: Fuel,
      label: 'Fuel Analytics',
      shortLabel: 'Fuel',
      permissions: [],
    },
    {
      to: '/fleet/maintenance',
      icon: Wrench,
      label: 'Maintenance',
      shortLabel: 'Maint.',
      permissions: [],
    },
    {
      to: '/fleet/vehicles',
      icon: Car,
      label: 'All Vehicles',
      shortLabel: 'Vehicles',
      permissions: [],
    },
    {
      to: '/fleet/investigation',
      icon: FileSearch,
      label: 'GPS Investigation',
      shortLabel: 'GPS',
      permissions: [],
    },
    {
      to: '/fleet/locations',
      icon: MapPin,
      label: 'Authorized Locations',
      shortLabel: 'Locations',
      permissions: [],
    },
    {
      to: '/fleet/portal',
      icon: ScanLine,
      label: 'Vehicle Portal',
      shortLabel: 'Portal',
      permissions: [],
    },
    {
      to: '/fleet/check-in/audit',
      icon: ClipboardList,
      label: 'Check-In Audit',
      shortLabel: 'Audit',
      permissions: [],
    },
  ],
};
