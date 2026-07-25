'use client';

import { CheckCircle, Clock, XCircle, Copy } from 'lucide-react';
import { StatsGrid } from '@/components/dashboard/EnhancedStatCard';
import type { EnhancedStatCardProps } from '@/components/dashboard/EnhancedStatCard';
import type { ReconModel } from '../types';

interface BreakdownCardsProps {
  totals: ReconModel['totals'];
  /** Features never captured, split by kind — the combined total mixes optical features and civil poles. */
  opticalNeverCaptured: number;
  civilNeverCaptured: number;
  isLoading?: boolean;
}

export function BreakdownCards({ totals, opticalNeverCaptured, civilNeverCaptured, isLoading }: BreakdownCardsProps) {
  const cards: EnhancedStatCardProps[] = [
    {
      title: 'Applied',
      value: totals.applied,
      icon: CheckCircle,
      color: '#10B981',
      description: 'Features net-complete in the audit trail',
      variant: 'detailed',
      isLoading,
    },
    {
      title: 'Stuck (recoverable)',
      value: totals.stuckRecoverable,
      icon: Clock,
      color: '#D97706',
      description: 'Started but never confirmed applied',
      variant: 'detailed',
      isLoading,
    },
    {
      title: 'Never captured',
      value: totals.neverCaptured,
      icon: XCircle,
      color: '#EF4444',
      description: `${opticalNeverCaptured} optical / ${civilNeverCaptured} civil (poles)`,
      variant: 'detailed',
      isLoading,
    },
    {
      title: 'Stale duplicates',
      value: totals.staleDuplicate,
      icon: Copy,
      color: '#6B7280',
      subtitle: 'Recovered',
      description: 'Superseded by an applied twin delta',
      variant: 'detailed',
      isLoading,
    },
  ];

  return <StatsGrid cards={cards} columns={4} />;
}
