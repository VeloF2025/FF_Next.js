/**
 * Pole Stats Component
 * Displays pole statistics and key metrics
 */

import { 
  Layers, 
  CheckCircle, 
  Camera, 
  Calendar 
} from 'lucide-react';
import { StatCard } from '../../../../components/dashboard/StatCard';
import { PoleDetail, StatConfig } from '../types/pole-detail.types';

interface PoleStatsProps {
  pole: PoleDetail;
}

export function PoleStats({ pole }: PoleStatsProps) {
  const stats: StatConfig[] = [
    {
      title: 'Capacity Used',
      subtitle: 'Drops connected',
      value: `${pole.dropCount}/${pole.maxCapacity}`,
      subValue: `${Math.round((pole.dropCount / pole.maxCapacity) * 100)}%`,
      icon: Layers,
      color: '#3b82f6'
    },
    {
      title: 'Quality Status',
      subtitle: 'Checks completed',
      value: pole.qualityStatus === 'pass' ? 'PASS' : 'PENDING',
      subValue: `${pole.qualityChecks.filter(q => q.status === 'pass').length}/${pole.qualityChecks.length} checks`,
      icon: CheckCircle,
      color: pole.qualityStatus === 'pass' ? '#059669' : '#d97706'
    },
    {
      title: 'Photos',
      subtitle: 'Documentation',
      value: pole.photos.length,
      subValue: 'Photos uploaded',
      icon: Camera,
      color: '#7c3aed'
    },
    {
      title: 'Days Active',
      subtitle: 'Since installation',
      value: Math.ceil((new Date().getTime() - pole.dateInstalled.getTime()) / (1000 * 60 * 60 * 24)),
      subValue: 'Days',
      icon: Calendar,
      color: '#059669'
    }
  ];

  return (
    <div className="ff-stats-grid">
      {stats.map((stat) => (
        <StatCard
          key={stat.title}
          title={stat.title}
          subtitle={stat.subtitle}
          value={stat.value}
          subValue={stat.subValue}
          icon={stat.icon as import('lucide-react').LucideIcon}
          color={stat.color}
        />
      ))}
    </div>
  );
}