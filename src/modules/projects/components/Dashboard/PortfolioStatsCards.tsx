/**
 * Portfolio Stats Cards (PRD-058)
 * Displays project status counts with clickable navigation
 */

import React from 'react';
import Link from 'next/link';
import {
  Folder,
  Clock,
  PlayCircle,
  CheckCircle,
  AlertTriangle,
  FileText,
} from 'lucide-react';
import type { PortfolioCounts, ExpiringDocsMetrics } from './types';

interface PortfolioStatsCardsProps {
  counts: PortfolioCounts;
  expiringDocs: ExpiringDocsMetrics;
  isLoading?: boolean;
}

interface StatCard {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  href?: string;
  alert?: boolean;
}

export function PortfolioStatsCards({
  counts,
  expiringDocs,
  isLoading = false,
}: PortfolioStatsCardsProps) {
  const cards: StatCard[] = [
    {
      label: 'Total Projects',
      value: counts.total,
      icon: <Folder className="w-6 h-6" />,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/20',
      href: '/projects?tab=all',
    },
    {
      label: 'Pipeline',
      value: counts.pipeline,
      icon: <FileText className="w-6 h-6" />,
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/20',
      href: '/pipeline',
    },
    {
      label: 'Planned',
      value: counts.planned,
      icon: <Clock className="w-6 h-6" />,
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/20',
      href: '/projects?tab=all&status=planned',
    },
    {
      label: 'Active',
      value: counts.active,
      icon: <PlayCircle className="w-6 h-6" />,
      color: 'text-green-400',
      bgColor: 'bg-green-500/20',
      href: '/projects?tab=all&status=active',
    },
    {
      label: 'Completed',
      value: counts.completed,
      icon: <CheckCircle className="w-6 h-6" />,
      color: 'text-cyan-400',
      bgColor: 'bg-cyan-500/20',
      href: '/projects?tab=all&status=completed',
    },
    {
      label: 'Docs Expiring',
      value: expiringDocs.count30Days + expiringDocs.count60Days,
      icon: <AlertTriangle className="w-6 h-6" />,
      color: expiringDocs.count30Days > 0 ? 'text-red-400' : 'text-orange-400',
      bgColor: expiringDocs.count30Days > 0 ? 'bg-red-500/20' : 'bg-orange-500/20',
      href: '/projects?tab=expiring',
      alert: expiringDocs.count30Days > 0,
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="ff-card animate-pulse"
            style={{ '--stat-color': '#6b7280' } as React.CSSProperties}
          >
            <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {cards.map((card) => {
        const CardWrapper = card.href ? Link : 'div';
        const wrapperProps = card.href ? { href: card.href } : {};

        return (
          <CardWrapper
            key={card.label}
            {...wrapperProps}
            className={`
              ff-stat-card relative overflow-hidden
              ${card.href ? 'cursor-pointer hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5' : ''}
              ${card.alert ? 'ring-2 ring-red-500/50' : ''}
            `}
            style={{ '--stat-color': card.color.includes('blue') ? '#3b82f6' :
                     card.color.includes('purple') ? '#8b5cf6' :
                     card.color.includes('amber') ? '#f59e0b' :
                     card.color.includes('green') ? '#10b981' :
                     card.color.includes('cyan') ? '#06b6d4' :
                     card.color.includes('red') ? '#ef4444' :
                     card.color.includes('orange') ? '#f97316' : '#6b7280'
            } as React.CSSProperties}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--ff-text-secondary)] font-medium mb-1">
                  {card.label}
                </p>
                <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  {card.value.toLocaleString()}
                </p>
              </div>
              <div className={`p-2 rounded-lg ${card.bgColor}`}>
                <span className={card.color}>{card.icon}</span>
              </div>
            </div>
            {card.alert && (
              <div className="absolute top-2 right-2">
                <span className="flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                </span>
              </div>
            )}
          </CardWrapper>
        );
      })}
    </div>
  );
}

export default PortfolioStatsCards;
