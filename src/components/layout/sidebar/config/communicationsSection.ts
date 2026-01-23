/**
 * Communications section configuration
 */

import { MessageSquare, Users, CheckCircle, ListTodo, Phone, FileText } from 'lucide-react';
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
      to: PDFCRAFT_URL,
      icon: FileText,
      label: 'PDF Tools',
      shortLabel: 'PDF',
      permissions: [],
      external: true,
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
      to: '/communications/dev-queue',
      icon: ListTodo,
      label: 'Dev Queue',
      shortLabel: 'DevQ',
      permissions: [],
    },
  ]
};