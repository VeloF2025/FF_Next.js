import React from 'react';
import { Package, AlertTriangle, CheckCircle, DollarSign } from 'lucide-react';
import type { StockStats } from '../types/stock.types';

interface StockStatsCardsProps {
  stats: StockStats;
}

export const StockStatsCards: React.FC<StockStatsCardsProps> = ({ stats }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <div className="flex items-center">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <Package className="h-6 w-6 text-blue-400" />
          </div>
          <div className="ml-4">
            <p className="text-sm text-[var(--ff-text-secondary)]">Total Items</p>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.totalItems}</p>
          </div>
        </div>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <div className="flex items-center">
          <div className="p-2 bg-red-500/20 rounded-lg">
            <AlertTriangle className="h-6 w-6 text-red-400" />
          </div>
          <div className="ml-4">
            <p className="text-sm text-[var(--ff-text-secondary)]">Low Stock</p>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.lowStock}</p>
          </div>
        </div>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <div className="flex items-center">
          <div className="p-2 bg-[var(--ff-bg-tertiary)] rounded-lg">
            <CheckCircle className="h-6 w-6 text-[var(--ff-text-secondary)]" />
          </div>
          <div className="ml-4">
            <p className="text-sm text-[var(--ff-text-secondary)]">Out of Stock</p>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.outOfStock}</p>
          </div>
        </div>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <div className="flex items-center">
          <div className="p-2 bg-green-500/20 rounded-lg">
            <DollarSign className="h-6 w-6 text-green-400" />
          </div>
          <div className="ml-4">
            <p className="text-sm text-[var(--ff-text-secondary)]">Total Value</p>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
              R{stats.totalValue.toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
