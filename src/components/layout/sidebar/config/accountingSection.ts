/**
 * Accounting section configuration
 *
 * Single link — all sub-navigation is handled by the
 * Sage-style horizontal tab bar (AccountingNav) at the
 * top of every accounting page.
 */

import { Calculator } from 'lucide-react';
import type { NavSection } from './types';

export const accountingSection: NavSection = {
  section: 'ACCOUNTING',
  sectionId: 'accounting',
  isCollapsible: true,
  defaultExpanded: false,
  items: [
    {
      to: '/accounting',
      icon: Calculator,
      label: 'Accounting',
      shortLabel: 'Acct',
      permissions: [],
      rbacKey: 'accounting',
    },
  ],
};
