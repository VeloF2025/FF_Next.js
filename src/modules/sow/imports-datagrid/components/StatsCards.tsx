// ============= Stats Cards Component =============

import { Grid3x3, Cable, MapPin, Link } from 'lucide-react';
import { StatCard, StatCardGrid } from '@/components/ui/StatCard';

interface StatsCardsProps {
  polesCount: number;
  fibreCount: number;
  dropsCount: number;
  onemapCount: number;
  nokiaCount: number;
}

export function StatsCards({
  polesCount,
  fibreCount,
  dropsCount,
  onemapCount,
  nokiaCount
}: StatsCardsProps) {
  return (
    <StatCardGrid columns={5} className="mb-6">
      <StatCard
        label="SOW Poles"
        value={polesCount}
        icon={MapPin}
        colorType="sent"
      />
      <StatCard
        label="Fibre Segments"
        value={fibreCount}
        icon={Cable}
        colorType="total"
      />
      <StatCard
        label="SOW Drops"
        value={dropsCount}
        icon={Link}
        colorType="active"
      />
      <StatCard
        label="OneMap Records"
        value={onemapCount}
        icon={Grid3x3}
        colorType="financial"
      />
      <StatCard
        label="Nokia Drops"
        value={nokiaCount}
        icon={Cable}
        colorType="error"
      />
    </StatCardGrid>
  );
}
