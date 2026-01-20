import React from 'react';
import { Package, AlertTriangle, CheckCircle, DollarSign } from 'lucide-react';
import { StatCard, StatCardGrid } from '@/components/ui/StatCard';
import type { StockStats } from '../types/stock.types';

interface StockStatsCardsProps {
  stats: StockStats;
}

export const StockStatsCards: React.FC<StockStatsCardsProps> = ({ stats }) => {
  return (
    <StatCardGrid columns={4}>
      <StatCard
        label="Total Items"
        value={stats.totalItems}
        icon={Package}
        colorType="total"
      />
      <StatCard
        label="Low Stock"
        value={stats.lowStock}
        icon={AlertTriangle}
        colorType="warning"
      />
      <StatCard
        label="Out of Stock"
        value={stats.outOfStock}
        icon={CheckCircle}
        colorType="error"
      />
      <StatCard
        label="Total Value"
        value={`R${stats.totalValue.toLocaleString()}`}
        icon={DollarSign}
        colorType="success"
      />
    </StatCardGrid>
  );
};
