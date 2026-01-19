/**
 * Communications section configuration
 */

import { MessageSquare, Users, CheckCircle, ListTodo } from 'lucide-react';
import type { NavSection } from './types';

export const communicationsSection: NavSection = {
  section: 'COMMUNICATIONS',
  sectionId: 'communications',
  isCollapsible: true,
  items: [
    {
      to: '/communications',
      icon: MessageSquare,
      label: 'Communications Portal',
      shortLabel: 'Comms',
      permissions: [],
    },
    {
      to: '/meetings',
      icon: Users,
      label: 'Meetings',
      shortLabel: 'Meet',
      permissions: [],
    },
    {
      to: '/action-items',
      icon: CheckCircle,
      label: 'Action Items',
      shortLabel: 'Actions',
      permissions: [],
    },
    {
      to: '/communications/wishlist',
      icon: ListTodo,
      label: 'Wishlist',
      shortLabel: 'Wishlist',
      permissions: [],
    },
  ]
};