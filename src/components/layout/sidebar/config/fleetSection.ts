/**
 * Fleet section configuration
 * Vehicle management and GPS trip investigation
 */

import {
  Truck,
  Car,
  MapPin,
  FileSearch,
  BarChart3,
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
  ],
};
