/**
 * Human Resources section configuration
 *
 * Uses sectionLink to make the header itself a direct link to /staff
 * instead of having a dropdown with a single item.
 */

import { Users } from 'lucide-react';
import type { NavSection } from './types';

export const peopleSection: NavSection = {
  section: 'Human Resources',
  sectionId: 'people',
  sectionLink: '/staff', // Direct link - no dropdown
  isCollapsible: false,
  items: [
    {
      to: '/staff',
      icon: Users,
      label: 'Human Resources',
      shortLabel: 'HR',
      permissions: [],
      rbacKey: 'people.staff',
    },
  ]
};