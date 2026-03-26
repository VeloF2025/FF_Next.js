/**
 * DevOps section configuration
 */

import { Database } from 'lucide-react';
import type { NavSection } from './types';
import { Permission } from '@/types/auth.types';

export const devopsSection: NavSection = {
  section: 'DEVOPS',
  sectionId: 'devops',
  isCollapsible: true,
  items: [
    {
      to: '/devops/schema',
      icon: Database,
      label: 'Schema Explorer',
      shortLabel: 'Schema',
      permissions: [Permission.SYSTEM_ADMIN],
      rbacKey: 'devops.schema',
    },
    {
      to: '/devops/field-mapping',
      icon: Database,
      label: 'Field Mapping',
      shortLabel: 'Mapping',
      permissions: [Permission.SYSTEM_ADMIN],
      rbacKey: 'devops.field-mapping',
    },
  ],
};
