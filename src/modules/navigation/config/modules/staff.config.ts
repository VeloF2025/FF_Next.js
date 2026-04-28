/**
 * Staff Module Navigation Config
 * Tab configuration for the Staff/HR module
 */

import {
  Users,
  Bell,
  Upload,
  Cake,
  ShieldCheck,
  Building2,
  Activity,
  Receipt,
  FileText,
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
      id: 'pulse',
      label: 'Pulse',
      icon: Activity,
      path: '/staff/attendance',
      rbacKey: 'people.staff.attendance.manage',
    },
    {
      id: 'payslips',
      label: 'Payslips',
      icon: FileText,
      path: '/staff/payslips/import',
      rbacKey: 'payslips.import',
    },
    {
      id: 'receipts',
      label: 'Receipts',
      icon: Receipt,
      path: '/staff/receipts',
      rbacKey: 'receipts.review',
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
