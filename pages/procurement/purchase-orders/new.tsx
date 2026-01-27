// WORKING: Create Purchase Order form page
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import { ProcurementTabs } from '@/modules/procurement/components/ProcurementTabs';
import {
  ShoppingCart,
  ArrowLeft,
  Plus,
  Trash2,
  Building,
  Truck,
  CreditCard,
} from 'lucide-react';
import { log } from '@/lib/logger';

// Types
interface POItem {
  id: string;
  itemDescription: string;
  itemCode: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  notes: string;
}

interface Supplier {
  id: string;
  companyName: string;
}

interface Project {
  id: string;
  name: string;
  project_code: string;
}

const UOM_OPTIONS = [
  { value: 'units', label: 'Units' },
  { value: 'pcs', label: 'Pieces' },
  { value: 'meters', label: 'Meters' },
  { value: 'rolls', label: 'Rolls' },
  { value: 'boxes', label: 'Boxes' },
  { value: 'sets', label: 'Sets' },
  { value: 'liters', label: 'Liters' },
  { value: 'kg', label: 'Kilograms' },
];

const PAYMENT_TERMS = [
  { value: 'cod', label: 'Cash on Delivery (COD)' },
  { value: 'net7', label: 'Net 7 Days' },
  { value: 'net14', label: 'Net 14 Days' },
  { value: 'net30', label: 'Net 30 Days' },
  { value: 'net60', label: 'Net 60 Days' },
  { value: 'eom', label: 'End of Month' },
  { value: 'prepaid', label: 'Prepaid' },
];

const VAT_RATES = [
  { value: 0, label: '0% (Zero Rated)' },
  { value: 15, label: '15% (Standard)' },
];

const createEmptyItem = (): POItem => ({
  id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  itemDescription: '',
  itemCode: '',
  quantity: 0,
  uom: 'units',
  unitPrice: 0,
  notes: '',
});

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<string>('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('net30');
  const [currency] = useState('ZAR');
  const [vatRate, setVatRate] = useState(15);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<POItem[]>([createEmptyItem()]);

  // Reference data
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    fetchSuppliers();
    fetchProjects();
  }, []);

  const fetchSuppliers = async () => {
    try {
      const response = await fetch('/api/suppliers?active=true');
      const data = await response.json();
      if (data.success) {
        setSuppliers(data.data || []);
      }
    } catch (err) {
      log.error('Failed to fetch suppliers', err);
    }
  };

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects?status=active');
      const data = await response.json();
      if (data.success) {
        setProjects(data.data || []);
      }
    } catch (err) {
      log.error('Failed to fetch projects', err);
    }
  };

  const handleAddItem = () => {
    setItems([...items, createEmptyItem()]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const handleItemChange = (index: number, field: keyof POItem, value: string | number) => {
    setItems(items.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  const calculateLineTotal = (quantity: number, unitPrice: number) => {
    return Math.round(quantity * unitPrice * 100) / 100;
  };

  const subtotal = items.reduce((sum, item) => sum + calculateLineTotal(item.quantity, item.unitPrice), 0);
  const vatAmount = Math.round(subtotal * (vatRate / 100) * 100) / 100;
  const total = Math.round((subtotal + vatAmount) * 100) / 100;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate
    if (!supplierId) {
      setError('Please select a supplier');
      return;
    }

    if (!deliveryAddress || deliveryAddress.length < 10) {
      setError('Delivery address must be at least 10 characters');
      return;
    }

    const validItems = items.filter((item) => item.itemDescription.trim().length >= 3);
    if (validItems.length === 0) {
      setError('Please add at least one item with a description');
      return;
    }

    try {
      setIsSubmitting(true);

      const response = await fetch('/api/procurement/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId,
          projectId: projectId || null,
          deliveryAddress,
          deliveryDate: deliveryDate || null,
          paymentTerms,
          currency,
          vatRate,
          notes: notes || null,
          items: validItems.map((item) => ({
            itemDescription: item.itemDescription,
            itemCode: item.itemCode || null,
            quantity: item.quantity,
            uom: item.uom,
            unitPrice: item.unitPrice,
            notes: item.notes || null,
          })),
        }),
      });

      const data = await response.json();

      if (data.success) {
        router.push(`/procurement/purchase-orders/${data.data.id}`);
      } else {
        setError(data.error?.message || 'Failed to create purchase order');
      }
    } catch (err) {
      log.error('Failed to create purchase order', err);
      setError('Failed to create purchase order');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.back()}
                className="p-2 rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
              >
                <ArrowLeft className="h-5 w-5 text-[var(--ff-text-secondary)]" />
              </button>
              <div className="p-2 rounded-lg bg-blue-500/20">
                <ShoppingCart className="h-6 w-6 text-blue-400" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
                  New Purchase Order
                </h1>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  Create a purchase order for a supplier
                </p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="px-6 border-t border-[var(--ff-border-light)]">
            <ProcurementTabs activeTab="purchase-orders" categoriesOnly />
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 max-w-5xl mx-auto">
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
              {error}
            </div>
          )}

          {/* Supplier & Project Section */}
          <div className="mb-6 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <Building className="h-5 w-5 text-blue-400" />
              <h2 className="text-lg font-medium text-[var(--ff-text-primary)]">Supplier & Project</h2>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Supplier <span className="text-red-400">*</span>
                </label>
                <select
                  value={supplierId || ''}
                  onChange={(e) => setSupplierId(e.target.value ? parseInt(e.target.value, 10) : null)}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  required
                >
                  <option value="">Select a supplier</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.companyName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Project (Optional)
                </label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  <option value="">No project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} ({project.project_code})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Delivery Section */}
          <div className="mb-6 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <Truck className="h-5 w-5 text-blue-400" />
              <h2 className="text-lg font-medium text-[var(--ff-text-primary)]">Delivery Details</h2>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Delivery Address <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                  placeholder="Full delivery address..."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Expected Delivery Date
                </label>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
            </div>
          </div>

          {/* Payment Section */}
          <div className="mb-6 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <CreditCard className="h-5 w-5 text-blue-400" />
              <h2 className="text-lg font-medium text-[var(--ff-text-primary)]">Payment Terms</h2>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Payment Terms <span className="text-red-400">*</span>
                </label>
                <select
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  required
                >
                  {PAYMENT_TERMS.map((term) => (
                    <option key={term.value} value={term.value}>
                      {term.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  VAT Rate
                </label>
                <select
                  value={vatRate}
                  onChange={(e) => setVatRate(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  {VAT_RATES.map((rate) => (
                    <option key={rate.value} value={rate.value}>
                      {rate.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                  placeholder="Additional notes..."
                />
              </div>
            </div>
          </div>

          {/* Items Section */}
          <div className="mb-6 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-[var(--ff-text-primary)]">Items</h2>
              <button
                type="button"
                onClick={handleAddItem}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add Item
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--ff-border-light)]">
                    <th className="px-2 py-2 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                      Description <span className="text-red-400">*</span>
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-24">
                      Code
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-20">
                      Qty <span className="text-red-400">*</span>
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-24">
                      UOM <span className="text-red-400">*</span>
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-28">
                      Unit Price <span className="text-red-400">*</span>
                    </th>
                    <th className="px-2 py-2 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-28">
                      Line Total
                    </th>
                    <th className="px-2 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ff-border-light)]">
                  {items.map((item, index) => (
                    <tr key={item.id}>
                      <td className="px-2 py-2">
                        <input
                          type="text"
                          value={item.itemDescription}
                          onChange={(e) => handleItemChange(index, 'itemDescription', e.target.value)}
                          className="w-full px-2 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                          placeholder="Item description"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="text"
                          value={item.itemCode}
                          onChange={(e) => handleItemChange(index, 'itemCode', e.target.value)}
                          className="w-full px-2 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                          placeholder="SKU"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          value={item.quantity || ''}
                          onChange={(e) => handleItemChange(index, 'quantity', parseFloat(e.target.value) || 0)}
                          min="0"
                          step="1"
                          className="w-full px-2 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] text-right focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={item.uom}
                          onChange={(e) => handleItemChange(index, 'uom', e.target.value)}
                          className="w-full px-2 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                        >
                          {UOM_OPTIONS.map((uom) => (
                            <option key={uom.value} value={uom.value}>
                              {uom.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)] text-sm">
                            R
                          </span>
                          <input
                            type="number"
                            value={item.unitPrice || ''}
                            onChange={(e) => handleItemChange(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                            min="0"
                            step="0.01"
                            className="w-full pl-6 pr-2 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] text-right focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                          />
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right text-[var(--ff-text-primary)] font-medium">
                        {formatCurrency(calculateLineTotal(item.quantity, item.unitPrice))}
                      </td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(index)}
                          disabled={items.length === 1}
                          className="p-1 text-red-400 hover:bg-red-500/10 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary */}
          <div className="mb-6 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
            <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Summary</h2>
            <div className="space-y-2 max-w-xs ml-auto">
              <div className="flex justify-between">
                <span className="text-[var(--ff-text-secondary)]">Subtotal</span>
                <span className="text-[var(--ff-text-primary)]">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--ff-text-secondary)]">VAT ({vatRate}%)</span>
                <span className="text-[var(--ff-text-primary)]">{formatCurrency(vatAmount)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-[var(--ff-border-light)]">
                <span className="text-[var(--ff-text-primary)] font-medium">Total</span>
                <span className="text-[var(--ff-text-primary)] font-semibold text-lg">{formatCurrency(total)}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-4 py-2 border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {isSubmitting && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
              Create Purchase Order
            </button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}
