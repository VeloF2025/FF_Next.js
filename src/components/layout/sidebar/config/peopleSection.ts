/**
 * Human Resources section configuration
 */

import { Users } from 'lucide-react';
import type { NavSection } from './types';

export const peopleSection: NavSection = {
  section: 'HUMAN RESOURCES',
  sectionId: 'people',
  isCollapsible: true,
  items: [
    {
      to: '/staff',
      icon: Users,
      label: 'Staff',
      shortLabel: 'Staff',
      permissions: [],
      rbacKey: 'people.staff',
    },
  ]
};