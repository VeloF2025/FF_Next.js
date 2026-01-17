/**
 * Field Operations section configuration
 */

import { Smartphone, MapPin, Wrench, MessageSquare, Camera, TrendingUp, FileCheck } from 'lucide-react';
import type { NavSection } from './types';

export const fieldOperationsSection: NavSection = {
  section: 'FIELD OPERATIONS',
  sectionId: 'field-ops',
  isCollapsible: true,
  items: [
    {
      to: '/field',
      icon: Smartphone,
      label: 'Field App Portal',
      shortLabel: 'Field',
      permissions: [],
    },
    {
      to: '/onemap',
      icon: MapPin,
      label: 'OneMap Data Grid',
      shortLabel: 'OneMap',
      permissions: [],
    },
    {
      to: '/nokia-equipment',
      icon: Wrench,
      label: 'Nokia Equipment',
      shortLabel: 'Nokia',
      permissions: [],
    },
    {
      to: '/wa-monitor',
      icon: MessageSquare,
      label: 'WA Monitor',
      shortLabel: 'WA',
      permissions: [],
    },
    {
      to: '/wa-monitor/dr-validation',
      icon: FileCheck,
      label: 'DR Validation',
      shortLabel: 'DR Valid',
      permissions: [],
    },
    {
      to: '/marketing-activations',
      icon: TrendingUp,
      label: 'Marketing Activations',
      shortLabel: 'Marketing',
      permissions: [],
    },
    {
      to: '/photo-review',
      icon: Camera,
      label: 'Photo Review',
      shortLabel: 'Photos',
      permissions: [],
    },
  ]
};