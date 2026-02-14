// ============= Items Tab Component =============
// Display PO line items with delivery progress

import React from 'react';
import { Package } from 'lucide-react';
import type { POItem } from '../../../../../types/procurement/po.types';
import { POItemCard } from '../POItemCard';

interface ItemsTabProps {
  items: POItem[];
  currency: string;
}

export const ItemsTab: React.FC<ItemsTabProps> = ({ items, currency }) => {
  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-600 dark:text-gray-400">No line items found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <POItemCard key={item.id} item={item} currency={currency} />
      ))}
    </div>
  );
};
