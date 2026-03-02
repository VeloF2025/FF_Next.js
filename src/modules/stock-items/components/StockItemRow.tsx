import { Package, ExternalLink, LogOut, LogIn, AlertTriangle } from 'lucide-react';
import type { StockItem, ToolCheckout } from '@/types/stockItem.types';
import { CATEGORY_COLORS, CHECKOUT_CATEGORIES } from '@/types/stockItem.types';

interface StockItemRowProps {
  item: StockItem;
  onClick: () => void;
  activeCheckout?: ToolCheckout | null;
  canManageCheckouts: boolean;
  onCheckOut?: (item: StockItem) => void;
  onCheckIn?: (item: StockItem, checkout: ToolCheckout) => void;
}

export function StockItemRow({ item, onClick, activeCheckout, canManageCheckouts, onCheckOut, onCheckIn }: StockItemRowProps) {
  const categoryColor = CATEGORY_COLORS[item.category] || 'bg-gray-500/20 text-gray-400';
  const isCheckoutEligible = CHECKOUT_CATEGORIES.includes(item.category);
  const isCheckedOut = !!activeCheckout;

  const stockStatus = item.qtyAvailable > 0
    ? item.qtyAvailable < (item.minStockLevel || 0)
      ? 'low'
      : 'in-stock'
    : 'out-of-stock';

  const stockStatusColors = {
    'in-stock': 'bg-green-500/20 text-green-400',
    'low': 'bg-yellow-500/20 text-yellow-400',
    'out-of-stock': 'bg-red-500/20 text-red-400',
  };

  const stockStatusLabels = {
    'in-stock': 'In Stock',
    'low': 'Low Stock',
    'out-of-stock': 'Out of Stock',
  };

  const handleCheckOutClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onCheckOut) onCheckOut(item);
  };

  const handleCheckInClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onCheckIn && activeCheckout) onCheckIn(item, activeCheckout);
  };

  return (
    <tr
      onClick={onClick}
      className="hover:bg-[var(--ff-bg-hover)] cursor-pointer transition-colors"
    >
      {/* Item Code */}
      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[var(--ff-bg-tertiary)] rounded-lg">
            <Package className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
          </div>
          <div>
            <div className="font-medium text-[var(--ff-text-primary)] text-sm">
              {item.itemCode.length > 50 ? item.itemCode.substring(0, 50) + '...' : item.itemCode}
            </div>
            {item.description && (
              <div className="text-xs text-[var(--ff-text-tertiary)] mt-0.5 max-w-xs truncate">
                {item.description}
              </div>
            )}
          </div>
        </div>
      </td>

      {/* Category */}
      <td className="px-4 py-4">
        <span className={`px-2 py-1 text-xs rounded-full ${categoryColor}`}>
          {item.category}
        </span>
      </td>

      {/* UOM */}
      <td className="px-4 py-4 text-sm text-[var(--ff-text-secondary)]">
        {item.uom}
      </td>

      {/* Available Qty */}
      <td className="px-4 py-4 text-right">
        <span className={`font-medium ${
          item.qtyAvailable > 0 ? 'text-[var(--ff-text-primary)]' : 'text-[var(--ff-text-tertiary)]'
        }`}>
          {item.qtyAvailable.toLocaleString()}
        </span>
        {item.qtyReserved > 0 && (
          <div className="text-xs text-[var(--ff-text-tertiary)]">
            {item.qtyReserved.toLocaleString()} reserved
          </div>
        )}
      </td>

      {/* Standard Cost */}
      <td className="px-4 py-4 text-right text-sm text-[var(--ff-text-secondary)]">
        {item.standardCost != null ? (
          <span>R{item.standardCost.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</span>
        ) : (
          <span className="text-[var(--ff-text-tertiary)]">-</span>
        )}
      </td>

      {/* Checkout Status */}
      <td className="px-4 py-4 text-center">
        {isCheckoutEligible ? (
          isCheckedOut ? (
            <div>
              <span className="px-2 py-1 text-xs rounded-full bg-orange-500/20 text-orange-400">
                Checked Out
              </span>
              <div className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                {activeCheckout.checkedOutByName || 'Unknown'}
              </div>
              <div className="text-xs text-[var(--ff-text-tertiary)]">
                Due: {activeCheckout.expectedReturnDate}
              </div>
            </div>
          ) : (
            <span className="px-2 py-1 text-xs rounded-full bg-green-500/20 text-green-400">
              Available
            </span>
          )
        ) : (
          <span className={`px-2 py-1 text-xs rounded-full ${stockStatusColors[stockStatus]}`}>
            {stockStatusLabels[stockStatus]}
          </span>
        )}
      </td>

      {/* Source */}
      <td className="px-4 py-4 text-center">
        {item.odooProductId ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-purple-500/20 text-purple-400 rounded-full">
            <ExternalLink className="h-3 w-3" />
            Odoo
          </span>
        ) : (
          <span className="px-2 py-1 text-xs bg-gray-500/20 text-gray-400 rounded-full">
            Manual
          </span>
        )}
      </td>

      {/* Actions */}
      {canManageCheckouts && (
        <td className="px-4 py-4 text-center">
          {isCheckoutEligible && (
            isCheckedOut ? (
              <button
                onClick={handleCheckInClick}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                <LogIn className="h-3 w-3" />
                Check In
              </button>
            ) : !item.serialNumber ? (
              <span
                title="Add a serial number to this item before checking out"
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-500/20 text-gray-400 rounded-lg cursor-not-allowed"
              >
                <AlertTriangle className="h-3 w-3" />
                No Serial
              </span>
            ) : (
              <button
                onClick={handleCheckOutClick}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors"
              >
                <LogOut className="h-3 w-3" />
                Check Out
              </button>
            )
          )}
        </td>
      )}
    </tr>
  );
}
