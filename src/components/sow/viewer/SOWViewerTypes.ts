/**
 * SOW Data Viewer Types and Configuration
 */

import { MapPin, Home, Cable, CheckCircle, LucideIcon } from 'lucide-react';
import type { SOWData } from '@/types/sow/base.types';

export interface SOWDataViewerProps {
  projectId: string;
  projectName: string;
}

export type TabType = 'poles' | 'drops' | 'fibre' | 'summary';

export interface TabConfig {
  id: TabType;
  label: string;
  icon: LucideIcon;
  count: number | null;
}

export const getTabsConfig = (data: Partial<SOWData> | null | undefined): TabConfig[] => [
  { 
    id: 'summary' as const, 
    label: 'Summary', 
    icon: CheckCircle,
    count: null
  },
  { 
    id: 'poles' as const, 
    label: 'Poles', 
    icon: MapPin,
    count: data?.poles?.length || 0
  },
  { 
    id: 'drops' as const, 
    label: 'Drops', 
    icon: Home,
    count: data?.drops?.length || 0
  },
  { 
    id: 'fibre' as const, 
    label: 'Fibre', 
    icon: Cable,
    count: data?.fibre?.length || 0
  }
];