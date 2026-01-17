import { useState, useEffect } from 'react';
import { X, Package, Trash2, AlertCircle, ExternalLink, Loader2 } from 'lucide-react';
import { useStockItemMutations } from '../hooks/useStockItems';
import type { StockItem, CreateStockItemInput } from '@/types/stockItem.types';
import { CATEGORY_COLORS, TRACKING_TYPE_LABELS } from '@/types/stockItem.types';

interface StockItemModalProps {
  item: StockItem | null;
  onClose: () => void;
  onSave: () => void;
}

export function StockItemModal({ item, onClose, onSave }: StockItemModalProps) {
  const isEditing = !!item;
  const { createItem, updateItem, deleteItem, isSubmitting, error, clearError } = useStockItemMutations();

  const [formData, setFormData] = useState<CreateStockItemInput>({
    itemCode: '',
    name: '',
    description: '',
    category: '',
    trackingType: 'quantity',
    uom: 'EA',
    standardCost: undefined,
    listPrice: undefined,
    currency: 'ZAR',
    minStockLevel: 0,
    maxStockLevel: undefined,
    reorderQuantity: undefined,
    isActive: true,
    isReturnable: false,
    productType: 'consu',
    purchaseOk: true,
    saleOk: false,
    qtyAvailable: 0,
  });

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'inventory' | 'suppliers'>('details');

  useEffect(() => {
    if (item) {
      setFormData({
        itemCode: item.itemCode,
        name: item.name,
        description: item.description || '',
        category: item.category,
        trackingType: item.trackingType,
        uom: item.uom,
        standardCost: item.standardCost ?? undefined,
        listPrice: item.listPrice ?? undefined,
        currency: item.currency,
        minStockLevel: item.minStockLevel,
        maxStockLevel: item.maxStockLevel ?? undefined,
        reorderQuantity: item.reorderQuantity ?? undefined,
        isActive: item.isActive,
        isReturnable: item.isReturnable,
        productType: item.productType,
        purchaseOk: item.purchaseOk,
        saleOk: item.saleOk,
        qtyAvailable: item.qtyAvailable,
      });
    }
  }, [item]);

  const handleChange = (field: keyof CreateStockItemInput, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    clearError();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isEditing && item) {
      const result = await updateItem({ ...formData, id: item.id });
      if (result) onSave();
    } else {
      const result = await createItem(formData);
      if (result) onSave();
    }
  };

  const handleDelete = async () => {
    if (!item) return;

    const forceDelete = item.odooProductId != null;
    const result = await deleteItem(item.id, forceDelete);
    if (result) onSave();
  };

  const categoryColor = item?.category ? CATEGORY_COLORS[item.category] || 'bg-gray-500/20 text-gray-400' : '';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ff-border-light)]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[var(--ff-bg-tertiary)] rounded-lg">
              <Package className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                {isEditing ? 'Edit Stock Item' : 'New Stock Item'}
              </h2>
              {isEditing && item?.odooProductId && (
                <div className="flex items-center gap-1 text-xs text-purple-400 mt-0.5">
                  <ExternalLink className="h-3 w-3" />
                  Synced from Odoo (ID: {item.odooProductId})
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--ff-bg-hover)] rounded-lg text-[var(--ff-text-tertiary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--ff-border-light)]">
          {(['details', 'inventory', 'suppliers'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium capitalize transition-colors ${
                activeTab === tab
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          {error && (
            <div className="mx-6 mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <div className="p-6 space-y-6">
            {/* Details Tab */}
            {activeTab === 'details' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Item Code *
                    </label>
                    <input
                      type="text"
                      value={formData.itemCode}
                      onChange={(e) => handleChange('itemCode', e.target.value)}
                      required
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., CAB-AER-SM-5.6-24F"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Name *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => handleChange('name', e.target.value)}
                      required
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Item name"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Description
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => handleChange('description', e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      placeholder="Optional description"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Category *
                    </label>
                    <input
                      type="text"
                      value={formData.category}
                      onChange={(e) => handleChange('category', e.target.value)}
                      required
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., optical, stringing"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Unit of Measure
                    </label>
                    <input
                      type="text"
                      value={formData.uom}
                      onChange={(e) => handleChange('uom', e.target.value)}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., EA, m, kg"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Tracking Type
                    </label>
                    <select
                      value={formData.trackingType}
                      onChange={(e) => handleChange('trackingType', e.target.value)}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {Object.entries(TRACKING_TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Product Type
                    </label>
                    <select
                      value={formData.productType}
                      onChange={(e) => handleChange('productType', e.target.value)}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="consu">Consumable</option>
                      <option value="product">Storable Product</option>
                      <option value="service">Service</option>
                    </select>
                  </div>
                </div>

                {/* Checkboxes */}
                <div className="flex flex-wrap gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.isActive}
                      onChange={(e) => handleChange('isActive', e.target.checked)}
                      className="rounded border-[var(--ff-border-light)] text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-[var(--ff-text-primary)]">Active</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.purchaseOk}
                      onChange={(e) => handleChange('purchaseOk', e.target.checked)}
                      className="rounded border-[var(--ff-border-light)] text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-[var(--ff-text-primary)]">Can be Purchased</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.saleOk}
                      onChange={(e) => handleChange('saleOk', e.target.checked)}
                      className="rounded border-[var(--ff-border-light)] text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-[var(--ff-text-primary)]">Can be Sold</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.isReturnable}
                      onChange={(e) => handleChange('isReturnable', e.target.checked)}
                      className="rounded border-[var(--ff-border-light)] text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-[var(--ff-text-primary)]">Returnable</span>
                  </label>
                </div>
              </>
            )}

            {/* Inventory Tab */}
            {activeTab === 'inventory' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Standard Cost (ZAR)
                  </label>
                  <input
                    type="number"
                    value={formData.standardCost ?? ''}
                    onChange={(e) => handleChange('standardCost', e.target.value ? Number(e.target.value) : undefined)}
                    step="0.01"
                    min="0"
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    List Price (ZAR)
                  </label>
                  <input
                    type="number"
                    value={formData.listPrice ?? ''}
                    onChange={(e) => handleChange('listPrice', e.target.value ? Number(e.target.value) : undefined)}
                    step="0.01"
                    min="0"
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Quantity Available
                  </label>
                  <input
                    type="number"
                    value={formData.qtyAvailable ?? ''}
                    onChange={(e) => handleChange('qtyAvailable', e.target.value ? Number(e.target.value) : 0)}
                    min="0"
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Min Stock Level
                  </label>
                  <input
                    type="number"
                    value={formData.minStockLevel ?? ''}
                    onChange={(e) => handleChange('minStockLevel', e.target.value ? Number(e.target.value) : 0)}
                    min="0"
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Max Stock Level
                  </label>
                  <input
                    type="number"
                    value={formData.maxStockLevel ?? ''}
                    onChange={(e) => handleChange('maxStockLevel', e.target.value ? Number(e.target.value) : undefined)}
                    min="0"
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Optional"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Reorder Quantity
                  </label>
                  <input
                    type="number"
                    value={formData.reorderQuantity ?? ''}
                    onChange={(e) => handleChange('reorderQuantity', e.target.value ? Number(e.target.value) : undefined)}
                    min="0"
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Optional"
                  />
                </div>

                {isEditing && item && (
                  <>
                    <div className="md:col-span-2 border-t border-[var(--ff-border-light)] pt-4 mt-2">
                      <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3">Current Stock Status</h3>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                          <p className="text-xs text-[var(--ff-text-tertiary)]">Available</p>
                          <p className="text-lg font-semibold text-green-400">{item.qtyAvailable.toLocaleString()}</p>
                        </div>
                        <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                          <p className="text-xs text-[var(--ff-text-tertiary)]">Reserved</p>
                          <p className="text-lg font-semibold text-yellow-400">{item.qtyReserved.toLocaleString()}</p>
                        </div>
                        <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                          <p className="text-xs text-[var(--ff-text-tertiary)]">On Order</p>
                          <p className="text-lg font-semibold text-blue-400">{item.qtyOnOrder.toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Suppliers Tab */}
            {activeTab === 'suppliers' && (
              <div>
                {isEditing && item?.supplierCodes && item.supplierCodes.length > 0 ? (
                  <div className="space-y-3">
                    {item.supplierCodes.map((sc) => (
                      <div
                        key={sc.id}
                        className="p-4 bg-[var(--ff-bg-tertiary)] rounded-lg border border-[var(--ff-border-light)]"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium text-[var(--ff-text-primary)]">{sc.supplierName}</p>
                            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                              Code: {sc.supplierItemCode}
                            </p>
                            {sc.supplierItemName && (
                              <p className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">
                                {sc.supplierItemName}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            {sc.supplierPrice && (
                              <p className="font-medium text-[var(--ff-text-primary)]">
                                {sc.supplierCurrency} {sc.supplierPrice.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
                              </p>
                            )}
                            {sc.isPreferred && (
                              <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded-full">
                                Preferred
                              </span>
                            )}
                          </div>
                        </div>
                        {sc.leadTimeDays && (
                          <p className="text-xs text-[var(--ff-text-tertiary)] mt-2">
                            Lead time: {sc.leadTimeDays} days
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-[var(--ff-text-secondary)]">
                    <Package className="h-12 w-12 mx-auto mb-3 text-[var(--ff-text-tertiary)]" />
                    <p>No supplier codes linked yet</p>
                    <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                      Supplier codes can be added via BOQ import
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
            <div>
              {isEditing && (
                <>
                  {showDeleteConfirm ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-red-400">Delete this item?</span>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={isSubmitting}
                        className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 text-white rounded"
                      >
                        Yes, Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(false)}
                        className="px-3 py-1 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="flex items-center gap-1 px-3 py-2 text-red-400 hover:text-red-300 text-sm"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isEditing ? 'Save Changes' : 'Create Item'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
