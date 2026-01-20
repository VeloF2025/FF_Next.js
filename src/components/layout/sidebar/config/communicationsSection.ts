/**
 * Communications section configuration
 */

import { MessageSquare, Users, CheckCircle, ListTodo, Phone } from 'lucide-react';
import type { NavSection } from './types';
import { Permission } from '@/types/auth.types';

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
      to: '/communications/whatsapp',
      icon: Phone,
      label: 'WhatsApp Portal',
      shortLabel: 'WhatsApp',
      permissions: [Permission.SYSTEM_ADMIN], // Admin only
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