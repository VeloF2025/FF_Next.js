/**
 * Contractors section configuration
 */

import { Briefcase, Activity } from 'lucide-react';
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
    },
    {
      to: '/contractors/rag-dashboard',
      icon: Activity,
      label: 'RAG Dashboard',
      shortLabel: 'RAG',
      permissions: [],
    },
  ]
};