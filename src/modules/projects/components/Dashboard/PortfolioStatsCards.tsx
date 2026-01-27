/**
 * Portfolio Stats Cards (PRD-058)
 * Displays project status counts using EnhancedStatCard (same as main dashboard)
 */

import React from 'react';
import {
  Folder,
  Clock,
  PlayCircle,
  CheckCircle,
  AlertTriangle,
  FileText,
} from 'lucide-react';
import { StatsGrid } from '@/components/dashboard/EnhancedStatCard';
import type { EnhancedStatCardProps } from '@/components/dashboard/EnhancedStatCard';
import type { PortfolioCounts, ExpiringDocsMetrics } from './types';

interface PortfolioStatsCardsProps {
  counts: PortfolioCounts;
  expiringDocs: ExpiringDocsMetrics;
  isLoading?: boolean;
}

export function PortfolioStatsCards({
  counts,
  expiringDocs,
  isLoading = false,
}: PortfolioStatsCardsProps) {
  const cards: EnhancedStatCardProps[] = [
    {
      title: 'Total Projects',
      value: counts.total,
      icon: Folder,
      color: '#3B82F6',
      subtitle: 'All projects',
      description: 'Total projects in portfolio',
      route: '/projects?tab=all',
      variant: 'detailed',
      isLoading,
    },
    {
      title: 'Pipeline',
      value: counts.pipeline,
      icon: FileText,
      color: '#8B5CF6',
      subtitle: 'In pipeline',
      description: 'Projects awaiting approval',
      route: '/pipeline',
      variant: 'detailed',
      isLoading,
    },
    {
      title: 'Planned',
      value: counts.planned,
      icon: Clock,
      color: '#F59E0B',
      subtitle: 'Scheduled',
      description: 'Projects in planning phase',
      route: '/projects?tab=all&status=planned',
      variant: 'detailed',
      isLoading,
    },
    {
      title: 'Active',
      value: counts.active,
      icon: PlayCircle,
      color: '#10B981',
      subtitle: 'In progress',
      description: 'Projects currently being worked on',
      route: '/projects?tab=all&status=active',
      variant: 'detailed',
      isLoading,
    },
    {
      title: 'Completed',
      value: counts.completed,
      icon: CheckCircle,
      color: '#06B6D4',
      subtitle: 'Finished',
      description: 'Successfully completed projects',
      route: '/projects?tab=all&status=completed',
      variant: 'detailed',
      isLoading,
    },
    {
      title: 'Docs Expiring',
      value: expiringDocs.count30Days + expiringDocs.count60Days,
      icon: AlertTriangle,
      color: expiringDocs.count30Days > 0 ? '#EF4444' : '#F97316',
      subtitle: expiringDocs.count30Days > 0 ? 'Urgent attention needed' : 'Within 60 days',
      description: `${expiringDocs.count30Days} within 30 days, ${expiringDocs.count60Days} within 60 days`,
      route: '/projects?tab=expiring',
      variant: 'detailed',
      isLoading,
    },
  ];

  return <StatsGrid cards={cards} columns={3} />;
}

export default PortfolioStatsCards;
