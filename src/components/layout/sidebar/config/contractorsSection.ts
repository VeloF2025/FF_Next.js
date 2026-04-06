/**
 * Contractors section configuration
 */

import { Briefcase, Activity, CalendarDays } from 'lucide-react';
import type { NavSection } from './types';

export const contractorsSection: NavSection = {
  section: 'CONTRACTORS',
  sectionId: 'contractors',
  isCollapsible: true,
  items: [
    {
      to: '/contractors',
      icon: Briefcase,
      label: 'Contractors Portal',
      shortLabel: 'Contract',
      permissions: [],
      rbacKey: 'contractors.list',
    },
    {
      to: '/contractors/rag-dashboard',
      icon: Activity,
      label: 'RAG Dashboard',
      shortLabel: 'RAG',
      permissions: [],
      rbacKey: 'contractors',
    },
    {
      to: '/site-visits',
      icon: CalendarDays,
      label: 'Site Visits',
      shortLabel: 'Visits',
      permissions: [],
      rbacKey: 'contractors',
    },
  ]
};