/**
 * Shared GROUP_TYPE_CONFIG for monitored group UI components
 */

import type { ElementType } from 'react';
import { MessageSquare, Wrench, Shield, HardHat, Zap } from 'lucide-react';
import type { WaGroupType } from '../types/wa-admin.types';

export const GROUP_TYPE_CONFIG: Record<WaGroupType, {
  icon: ElementType;
  color: string;
  label: string;
  description: string;
}> = {
  dr_submission: {
    icon: MessageSquare,
    color: 'text-blue-500 bg-blue-500/10',
    label: 'DR Submission',
    description: 'New installation photos - sends detailed acknowledgment',
  },
  maintenance: {
    icon: Wrench,
    color: 'text-orange-500 bg-orange-500/10',
    label: 'Maintenance',
    description: 'Follow-up photos - reacts with emoji',
  },
  admin: {
    icon: Shield,
    color: 'text-purple-500 bg-purple-500/10',
    label: 'Admin',
    description: 'Commands and alerts - !status, !restart',
  },
  civil: {
    icon: HardHat,
    color: 'text-green-500 bg-green-500/10',
    label: 'Civil',
    description: 'Civil construction — pole planting, trenching',
  },
  optical: {
    icon: Zap,
    color: 'text-cyan-500 bg-cyan-500/10',
    label: 'Optical',
    description: 'Optical fiber — cable pulling, splicing',
  },
};
