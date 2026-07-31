/**
 * Health & Safety Module Navigation Config
 *
 * Top-level module since 2026-07-31 — previously a tab inside the Projects
 * module, which left every H&S page rendering Projects chrome (a "Projects"
 * header and the Projects tab bar above its own).
 *
 * rbacKey stays `projects.health-safety` throughout: the key already exists,
 * every role holds view on it, and every H&S page and API route checks it.
 */

import { AlertCircle, AlertTriangle, BookOpen, ClipboardCheck, FileCheck, FileSignature, GraduationCap, HardHat, HeartPulse, Megaphone, Shield, ShieldCheck, TrendingUp } from 'lucide-react';
import type { ModuleNavigationConfig } from '../../types';

export const healthSafetyConfig: ModuleNavigationConfig = {
  moduleId: 'health-safety',
  moduleName: 'Health & Safety',
  description: 'Incidents, compliance, training and audits',
  basePath: '/health-safety',
  icon: Shield,
  tabs: [
    {
      id: 'hs-dashboard',
      label: 'Dashboard',
      icon: Shield,
      path: '/health-safety',
    },
    {
      id: 'incidents',
      label: 'Incidents',
      icon: AlertCircle,
      path: '/health-safety/incidents',
    },
    {
      id: 'checklists',
      label: 'Checklists',
      icon: ClipboardCheck,
      path: '/health-safety/checklists',
    },
    {
      id: 'training',
      label: 'Training',
      icon: GraduationCap,
      path: '/health-safety/training',
    },
    {
      id: 'checkins',
      label: 'Daily Check-In',
      icon: ShieldCheck,
      path: '/health-safety/checkins',
    },
    {
      id: 'medicals',
      label: 'Medical Fitness',
      icon: HeartPulse,
      path: '/health-safety/medicals',
    },
    {
      id: 'toolbox',
      label: 'Toolbox Talks',
      icon: Megaphone,
      path: '/health-safety/toolbox',
    },
    {
      id: 'ppe',
      label: 'PPE Register',
      icon: HardHat,
      path: '/health-safety/ppe',
    },
    {
      id: 'permits',
      label: 'Permits',
      icon: FileCheck,
      path: '/health-safety/permits',
    },
    {
      id: 'appointments',
      label: 'Appointments',
      icon: FileSignature,
      path: '/health-safety/appointments',
    },
    {
      id: 'analytics',
      label: 'Injury Rates',
      icon: TrendingUp,
      path: '/health-safety/analytics',
    },
    {
      id: 'capa',
      label: 'Corrective Actions',
      icon: AlertCircle,
      path: '/health-safety/capa',
    },
    {
      id: 'risks',
      label: 'Risk Register',
      icon: AlertTriangle,
      path: '/health-safety/risks',
    },
    {
      id: 'safety-library',
      label: 'Safety Library',
      icon: BookOpen,
      path: '/health-safety/safety-library',
    },
  ],
};
