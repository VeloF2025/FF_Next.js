import React from 'react';
import { User, Calendar, Truck, Package, ArrowRight, ArrowLeft, FileText } from 'lucide-react';
import { Button } from '@/src/shared/components/ui/Button';
import type { StockMovementData } from '../types/stock.types';

interface MovementsTabProps {
  movements: StockMovementData[];
  onViewAll: () => void;
}

export const MovementsTab: React.FC<MovementsTabProps> = ({ movements, onViewAll }) => {
  const getMovementTypeBadge = (type: StockMovementData['type']) => {
    const config = {
      'asn': { color: 'bg-blue-500/20 text-blue-400', label: 'ASN', icon: Truck },
      'grn': { color: 'bg-green-500/20 text-green-400', label: 'GRN', icon: Package },
      'issue': { color: 'bg-purple-500/20 text-purple-400', label: 'Issue', icon: ArrowRight },
      'transfer': { color: 'bg-orange-500/20 text-orange-400', label: 'Transfer', icon: ArrowLeft },
      'adjustment': { color: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]', label: 'Adjustment', icon: FileText }
    };

    const { color, label, icon: Icon } = config[type];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${color}`}>
        <Icon className="h-3 w-3" />
        {label}
      </span>
    );
  };

  const getStatusBadge = (status: StockMovementData['status']) => {
    const colors = {
      'completed': 'bg-green-500/20 text-green-400',
      'in-progress': 'bg-yellow-500/20 text-yellow-400',
      'pending': 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]',
      'cancelled': 'bg-red-500/20 text-red-400'
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status]}`}>
        {status.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Recent Stock Movements</h3>
        <Button variant="outline" onClick={onViewAll}>
          View All Movements
        </Button>
      </div>

      <div className="bg-[var(--ff-bg-tertiary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
        <div className="divide-y divide-[var(--ff-border-light)]">
          {movements.map((movement) => (
            <div key={movement.id} className="p-6 bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-hover)] transition-colors">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className="font-semibold text-[var(--ff-text-primary)]">{movement.reference}</h4>
                    {getMovementTypeBadge(movement.type)}
                  </div>
                  <p className="text-[var(--ff-text-primary)] mb-2">{movement.itemDescription}</p>
                  <div className="flex items-center gap-4 text-sm text-[var(--ff-text-secondary)]">
                    <span>{movement.itemCode}</span>
                    <span>{movement.quantity.toLocaleString()} {movement.unit}</span>
                    {movement.fromLocation && (
                      <span>From: {movement.fromLocation}</span>
                    )}
                    {movement.toLocation && (
                      <span>To: {movement.toLocation}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {getStatusBadge(movement.status)}
                </div>
              </div>

              <div className="flex items-center justify-between text-sm text-[var(--ff-text-secondary)]">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1">
                    <User className="h-4 w-4" />
                    {movement.createdBy}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {movement.createdDate.toLocaleDateString()}
                  </span>
                </div>
                <Button variant="outline" size="sm">
                  View Details
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
