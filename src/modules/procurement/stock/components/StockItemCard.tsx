import React from 'react';
import { Eye, Tag, MapPin, Truck, Calendar, ArrowRight, Plus } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { StatusBadge } from './StatusBadge';
import { formatDate } from '@/utils/dateFormat';
import type { StockItemData } from '../types/stock.types';

interface StockItemCardProps {
  item: StockItemData;
  isSelected: boolean;
  onToggleSelect: (id: string, checked: boolean) => void;
  onViewDetails: (id: string) => void;
  onStockAction?: (id: string, action: string) => void;
  canManageStock?: boolean;
}

export const StockItemCard: React.FC<StockItemCardProps> = ({
  item,
  isSelected,
  onToggleSelect,
  onViewDetails,
  onStockAction,
  canManageStock = false
}) => {
  return (
    <div className="p-6 bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-hover)] transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => onToggleSelect(item.id, e.target.checked)}
            className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-[var(--ff-border-light)] rounded"
          />
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">{item.itemCode}</h3>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                item.abc_classification === 'A' ? 'bg-red-500/20 text-red-400' :
                item.abc_classification === 'B' ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-green-500/20 text-green-400'
              }`}>
                Class {item.abc_classification}
              </span>
            </div>
            <p className="text-[var(--ff-text-primary)] mb-2">{item.description}</p>
            <div className="flex items-center gap-4 text-sm text-[var(--ff-text-secondary)]">
              <span className="flex items-center gap-1">
                <Tag className="h-4 w-4" />
                {item.category}
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {item.location}
              </span>
              <span className="flex items-center gap-1">
                <Truck className="h-4 w-4" />
                {item.supplier}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={item.status} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-4">
        <div>
          <p className="text-xs text-[var(--ff-text-secondary)]">Current Stock</p>
          <p className="font-semibold text-[var(--ff-text-primary)]">
            {item.currentStock.toLocaleString()} {item.unit}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--ff-text-secondary)]">Available</p>
          <p className="font-semibold text-green-400">
            {item.availableStock.toLocaleString()} {item.unit}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--ff-text-secondary)]">Reserved</p>
          <p className="font-semibold text-orange-400">
            {item.reservedStock.toLocaleString()} {item.unit}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--ff-text-secondary)]">Min Stock</p>
          <p className="font-semibold text-[var(--ff-text-primary)]">
            {item.minimumStock.toLocaleString()} {item.unit}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--ff-text-secondary)]">Total Value</p>
          <p className="font-semibold text-[var(--ff-text-primary)]">
            {item.currency} {item.totalValue.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--ff-text-secondary)]">Turnover</p>
          <p className="font-semibold text-blue-400">{item.stockTurnover}x</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm text-[var(--ff-text-secondary)]">
          {item.lastReceived && (
            <span className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              Last received: {item.lastReceived.toLocaleDateString()}
            </span>
          )}
          {item.lastIssued && (
            <span className="flex items-center gap-1">
              <ArrowRight className="h-4 w-4" />
              Last issued: {item.lastIssued.toLocaleDateString()}
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => onViewDetails(item.id)}>
            <Eye className="h-4 w-4 mr-1" />
            Details
          </Button>

          {canManageStock && onStockAction && (
            <>
              <Button variant="outline" size="sm" onClick={() => onStockAction(item.id, 'receive')}>
                <Plus className="h-4 w-4 mr-1" />
                Receive
              </Button>
              <Button variant="outline" size="sm" onClick={() => onStockAction(item.id, 'issue')}>
                <ArrowRight className="h-4 w-4 mr-1" />
                Issue
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
