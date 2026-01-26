/**
 * Staff Module Navigation Config
 * Tab configuration for the Staff/HR module
 */

import {
  Users,
  UserPlus,
  Bell,
  Upload,
  BarChart3,
  Cake,
  FileWarning,
  ShieldCheck,
} from 'lucide-react';
import type { ModuleNavigationConfig } from '../../types';

export const staffConfig: ModuleNavigationConfig = {
  moduleId: 'staff',
  moduleName: 'Staff Management',
  description: 'Manage team members, documents, and compliance',
  basePath: '/staff',
  icon: Users,
  tabs: [
    {
      id: 'directory',
      label: 'Directory',
      shortLabel: 'Staff',
      icon: Users,
      path: '/staff',
    },
    {
      id: 'alerts',
      label: 'Alerts',
      icon: Bell,
      path: '/staff/alerts',
      rbacKey: 'staff:alerts:view',
    },
    {
      id: 'birthdays',
      label: 'Birthdays',
      icon: Cake,
      path: '/staff/birthdays',
      rbacKey: 'staff:birthdays:view',
    },
    {
      id: 'compliance',
      label: 'Compliance',
      icon: ShieldCheck,
      path: '/staff/compliance',
      rbacKey: 'staff:compliance:view',
    },
    {
      id: 'import',
      label: 'Import',
      icon: Upload,
      path: '/staff/import',
      rbacKey: 'staff:import:view',
    },
  ],
};
