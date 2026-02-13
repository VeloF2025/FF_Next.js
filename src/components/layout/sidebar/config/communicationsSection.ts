/**
 * Communications section configuration
 */

import { MessageSquare, Users, CheckCircle, ListTodo, Phone, FileText, BookOpen, Satellite } from 'lucide-react';
import type { NavSection } from './types';
import { Permission } from '@/types/auth.types';

// PDFCraft URL - proxied via nginx at /pdf-tools/
const PDFCRAFT_URL = process.env.NEXT_PUBLIC_PDFCRAFT_URL || '/pdf-tools/';

export const communicationsSection: NavSection = {
  section: 'COMMUNICATIONS',
  sectionId: 'communications',
  isCollapsible: true,
  items: [
    {
      to: '/communications/help-center',
      icon: BookOpen,
      label: 'Help Center',
      shortLabel: 'Help',
      permissions: [],
      rbacKey: 'communications',
    },
    {
      to: '/communications/mission-control',
      icon: Satellite,
      label: 'Mission Control',
      shortLabel: 'MC',
      permissions: [Permission.SYSTEM_ADMIN],
      rbacKey: 'communications.mission-control',
    },
    {
      to: '/communications',
      icon: MessageSquare,
      label: 'Communications Portal',
      shortLabel: 'Comms',
      permissions: [],
      rbacKey: 'communications.main',
    },
    {
      to: '/communications/whatsapp',
      icon: Phone,
      label: 'WhatsApp Portal',
      shortLabel: 'WhatsApp',
      permissions: [Permission.SYSTEM_ADMIN], // Admin only
      rbacKey: 'communications.whatsapp',
    },
    {
      to: PDFCRAFT_URL,
      icon: FileText,
      label: 'PDF Tools',
      shortLabel: 'PDF',
      permissions: [],
      rbacKey: 'communications',
      external: true,
    },
    {
      to: '/communications?tab=meetings',
      icon: Users,
      label: 'Meetings',
      shortLabel: 'Meet',
      permissions: [],
      rbacKey: 'people.meetings',
    },
    {
      to: '/action-items',
      icon: CheckCircle,
      label: 'Action Items',
      shortLabel: 'Actions',
      permissions: [],
      rbacKey: 'dashboard.action-items',
    },
    {
      to: '/communications/dev-queue',
      icon: ListTodo,
      label: 'Dev Queue',
      shortLabel: 'DevQ',
      permissions: [],
      rbacKey: 'communications',
    },
  ]
};