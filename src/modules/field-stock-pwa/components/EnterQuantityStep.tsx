'use client';

/**
 * EnterQuantityStep — step 4 of the issue flow for NON-SERIAL items
 * (tracking_type lot | quantity | none). Replaces ScanSerialsStep for these
 * items: the stores person types how much is being handed out; photo proof
 * is captured later in SignAndSubmitStep (one photo per picking).
 *
 * Decimals allowed (planned_quantity is numeric(12,3) — cable is issued in
 * metres). Lot items carry lot_number=null in v1 (storemen don't pick lots;
 * all live stock_quants rows have NULL lot_number — see the plan's
 * "Verified facts").
 */

import { Package } from 'lucide-react';
import type { StockItem } from './PickItemStep';

export interface EnterQuantityStepProps {
  stockItem: StockItem;
  quantity: number;
  onChange: (quantity: number) => void;
  onDone: () => void;
}

export function EnterQuantityStep({ stockItem, quantity, onChange, onDone }: EnterQuantityStepProps) {
  const handleInput = (raw: string) => {
    if (raw === '') { onChange(0); return; }
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    onChange(Math.round(parsed * 1000) / 1000); // numeric(12,3)
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800">
        <Package className="w-4 h-4 text-neutral-500" />
        <div>
          <span className="text-sm font-medium text-white">{stockItem.name}</span>
          {stockItem.sku && <span className="ml-2 text-xs text-neutral-500">{stockItem.sku}</span>}
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="issue-quantity" className="text-sm font-medium text-neutral-300">
          Quantity
        </label>
        <div className="flex items-center gap-2">
          <input
            id="issue-quantity"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={quantity === 0 ? '' : quantity}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="0"
            className="flex-1 px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-white text-lg font-mono placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
          />
          {stockItem.uom && <span className="text-sm text-neutral-400 w-16">{stockItem.uom}</span>}
        </div>
        {stockItem.unitValueZar != null && quantity > 0 && (
          <p className="text-xs text-neutral-500">
            ≈ R{(stockItem.unitValueZar * quantity).toFixed(2)}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onDone}
        disabled={quantity <= 0}
        className="w-full py-3.5 rounded-lg bg-emerald-700 text-white font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-600 active:bg-emerald-800"
      >
        Continue
      </button>
    </div>
  );
}
