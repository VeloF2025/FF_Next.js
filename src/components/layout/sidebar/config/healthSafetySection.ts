/**
 * Health & Safety section configuration
 *
 * Top-level since 2026-07-31 — previously reached only as a tab inside
 * /projects. Sub-navigation stays as horizontal tabs on the page itself.
 *
 * rbacKey is deliberately still `projects.health-safety`: that key already
 * exists, every role holds view on it, and every H&S page and API route checks
 * it. Renaming it to match the new position would silently drop the gate and
 * revoke access for everyone.
 */

import { ShieldCheck } from 'lucide-react';
import type { NavSection } from './types';

export const healthSafetySection: NavSection = {
  section: 'Health & Safety',
  sectionId: 'health-safety',
  sectionLink: '/health-safety',
  isCollapsible: false,
  items: [
    {
      to: '/health-safety',
      icon: ShieldCheck,
      label: 'Health & Safety',
      shortLabel: 'H&S',
      permissions: [],
      rbacKey: 'projects.health-safety',
    },
  ],
};
