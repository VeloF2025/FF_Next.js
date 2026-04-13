import React from 'react';
import { Plus, AlertCircle } from 'lucide-react';
import { VelocityButton } from '@/components/ui/VelocityButton';
import { GlassCard } from '@/components/ui/GlassCard';
import { LineItemCard } from './LineItemCard';
import type { QuoteLineItem, RFQInvitation } from './types';

interface LineItemsStepProps {
  lineItems: QuoteLineItem[];
  errors: Record<string, string>;
  rfq: RFQInvitation;
  totalAmount: number;
  onUpdateItem: (index: number, field: keyof QuoteLineItem, value: string | number | undefined) => void;
  onAddItem: () => void;
  onRemoveItem: (index: number) => void;
}

export const LineItemsStep: React.FC<LineItemsStepProps> = ({
  lineItems,
  errors,
  rfq,
  totalAmount,
  onUpdateItem,
  onAddItem,
  onRemoveItem
}) => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Quote Line Items</h3>
        <VelocityButton onClick={onAddItem} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Add Item
        </VelocityButton>
      </div>

      {errors.lineItems && (
        <div className="flex items-center space-x-2 text-red-600 text-sm">
          <AlertCircle className="h-4 w-4" />
          <span>{errors.lineItems}</span>
        </div>
      )}

      <div className="space-y-4">
        {lineItems.map((item, index) => (
          <LineItemCard
            key={`${item.itemId}-${index}`}
            item={item}
            index={index}
            readOnly={!!rfq.items}
            errors={errors}
            onUpdate={onUpdateItem}
            onRemove={!rfq.items ? onRemoveItem : undefined}
          />
        ))}
      </div>

      {/* Quote Total */}
      <GlassCard className="bg-blue-50 border-blue-200">
        <div className="flex justify-between items-center">
          <span className="text-lg font-semibold text-foreground">Quote Total:</span>
          <span className="text-2xl font-bold text-blue-600">
            R{totalAmount.toLocaleString()}
          </span>
        </div>
      </GlassCard>
    </div>
  );
};
