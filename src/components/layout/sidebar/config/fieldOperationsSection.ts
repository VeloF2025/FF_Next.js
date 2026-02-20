/**
 * Field Operations section configuration
 */

import { Smartphone, MapPin, Wrench, MessageSquare, Camera, TrendingUp, FileCheck, CheckSquare, HardHat } from 'lucide-react';
import type { NavSection } from './types';

export const fieldOperationsSection: NavSection = {
  section: 'FIELD OPERATIONS',
  sectionId: 'field-ops',
  isCollapsible: true,
  items: [
    {
      to: '/construction-qa',
      icon: HardHat,
      label: 'Civil QA',
      shortLabel: 'CQA',
      permissions: [],
      rbacKey: 'field',
    },
    // QField QA deprecated — data migrated to Construction QA (2026-02-20)
    // { to: '/qfield/qa', icon: CheckSquare, label: 'QField QA', shortLabel: 'QF QA', permissions: [], rbacKey: 'field' },
    // Hidden items - uncomment as needed:
    // { to: '/field', icon: Smartphone, label: 'Field App Portal', shortLabel: 'Field', permissions: [], rbacKey: 'field' },
    // { to: '/onemap', icon: MapPin, label: 'OneMap Data Grid', shortLabel: 'OneMap', permissions: [], rbacKey: 'projects.onemap' },
    // { to: '/nokia-equipment', icon: Wrench, label: 'Nokia Equipment', shortLabel: 'Nokia', permissions: [], rbacKey: 'field' },
    // { to: '/wa-monitor', icon: MessageSquare, label: 'WA Monitor', shortLabel: 'WA', permissions: [], rbacKey: 'field' },
    // { to: '/wa-monitor/dr-validation', icon: FileCheck, label: 'DR Validation', shortLabel: 'DR Valid', permissions: [], rbacKey: 'field' },
    // { to: '/marketing-activations', icon: TrendingUp, label: 'Marketing Activations', shortLabel: 'Marketing', permissions: [], rbacKey: 'field' },
    // { to: '/photo-review', icon: Camera, label: 'Photo Review', shortLabel: 'Photos', permissions: [], rbacKey: 'activate' },
  ]
};