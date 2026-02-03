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
  Building2,
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
      id: 'departments',
      label: 'Departments',
      icon: Building2,
      path: '/staff/departments',
      rbacKey: 'people.staff.departments',
    },
    {
      id: 'alerts',
      label: 'Alerts',
      icon: Bell,
      path: '/staff/alerts',
      rbacKey: 'people.staff.alerts',
    },
    {
      id: 'birthdays',
      label: 'Birthdays',
      icon: Cake,
      path: '/staff/birthdays',
      rbacKey: 'people.staff.birthdays',
    },
    {
      id: 'compliance',
      label: 'Compliance',
      icon: ShieldCheck,
      path: '/staff/compliance',
      rbacKey: 'people.staff.compliance',
    },
    {
      id: 'import',
      label: 'Import',
      icon: Upload,
      path: '/staff/import',
      rbacKey: 'people.staff.import',
    },
  ],
};
