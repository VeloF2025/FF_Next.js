// WORKING: Create Goods Receipt Note Form
// PRD-050 Phase 2: Core Procurement - GRN
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import {
  PackageCheck,
  Plus,
  Trash2,
  ArrowLeft,
  Save,
  Loader2,
  AlertCircle,
  ChevronDown,
  Truck,
  Package,
  Building2,
} from 'lucide-react';
import { log } from '@/lib/logger';

// UOM Options
const UOM_OPTIONS = [
  { value: 'units', label: 'Units' },
  { value: 'pcs', label: 'Pieces' },
  { value: 'meters', label: 'Meters' },
  { value: 'rolls', label: 'Rolls' },
  { value: 'boxes', label: 'Boxes' },
  { value: 'sets', label: 'Sets' },
];

interface FormItem {
  id: string;
  poItemId?: string;
  itemCode: string;
  itemDescription: string;
  quantityExpected: number | '';
  quantityReceived: number | '';
  quantityRejected: number | '';
  uom: string;
  lotNumber: string;
  notes: string;
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierName: string;
  supplierId: number;
  status: string;
  itemCount: number;
  grnCount?: number;
  totalOrdered?: number;
  totalReceived?: number;
}

interface Supplier {
  id: number | string;
  name?: string;
  companyName?: string;
}

interface Location {
  id: string;
  name: string;
  locationType: string;
}

export default function NewGRNPage() {
  const router = useRouter();
  // Accept both ?purchaseOrderId= and ?po= (PO detail page uses ?po=)
  const purchaseOrderId = (router.query.purchaseOrderId || router.query.po) as string | undefined;
  // When arrived via a PO detail page link, lock the PO selection
  const isLinkedFromPO = !!purchaseOrderId;

  // Form state
  const [selectedPOId, setSelectedPOId] = useState<string>('');
  const [supplierId, setSupplierId] = useState<number | ''>('');
  // When linked from a PO that isn't in the available-pos list (e.g. status
  // filter excludes it) we still need to show the PO number + supplier name
  // in the locked header. Populate these from the PO detail API.
  const [linkedPODetail, setLinkedPODetail] = useState<{
    poNumber: string;
    supplierName: string;
  } | null>(null);
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [deliveryNoteNumber, setDeliveryNoteNumber] = useState('');
  const [carrier, setCarrier] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [receivingBay, setReceivingBay] = useState('');
  const [inspectionRequired, setInspectionRequired] = useState(false);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<FormItem[]>([
    {
      id: crypto.randomUUID(),
      itemCode: '',
      itemDescription: '',
      quantityExpected: '',
      quantityReceived: '',
      quantityRejected: '',
      uom: 'units',
      lotNumber: '',
      notes: '',
    },
  ]);

  // Reference data
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Load reference data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [posRes, suppliersRes, locationsRes] = await Promise.all([
          fetch('/api/procurement/grn/available-pos'),
          fetch('/api/suppliers'),
          fetch('/api/procurement/field-stock/locations'),
        ]);

        const posData = await posRes.json();
        if (posData.success) {
          setPurchaseOrders(posData.data || []);
        }

        const suppliersData = await suppliersRes.json();
        if (suppliersData.success) {
          setSuppliers(suppliersData.data || []);
        }

        const locationsData = await locationsRes.json();
        if (locationsData.success) {
          // Filter for warehouse type locations
          const warehouses = (locationsData.data || []).filter(
            (l: Location) => l.locationType === 'warehouse' || l.locationType === 'internal'
          );
          setLocations(warehouses);
        }

        // Pre-select PO if provided in URL (items loaded via the selectedPOId effect)
        if (purchaseOrderId && typeof purchaseOrderId === 'string') {
          setSelectedPOId(purchaseOrderId);
        }
      } catch (err) {
        log.error('Failed to load reference data', { error: err });
      } finally {
        setIsLoadingData(false);
      }
    };
    loadData();
  }, [purchaseOrderId]);

  // When a PO is selected (manually or via ?po= URL), pull supplier + line
  // items from the PO detail endpoint. This is the source of truth; the
  // available-pos list is a display convenience that can legitimately omit
  // POs the user still navigated to from a PO detail page.
  useEffect(() => {
    if (!selectedPOId) {
      setLinkedPODetail(null);
      return;
    }

    let cancelled = false;

    fetch(`/api/procurement/purchase-orders/${selectedPOId}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (!data?.success || !data.data) {
          setError(
            `Couldn't load PO ${selectedPOId.slice(0, 8)}… — supplier and items weren't pre-filled. Please refresh or pick a PO manually.`
          );
          return;
        }

        const po = data.data as {
          poNumber?: string;
          supplierId?: number;
          supplierName?: string;
          items?: Array<{
            id: string;
            itemCode: string | null;
            description: string;
            quantityOrdered: number;
            quantityReceived: number;
            quantityPending?: number;
            unitOfMeasure: string;
          }>;
        };

        if (typeof po.supplierId === 'number') {
          setSupplierId(po.supplierId);
        }
        setLinkedPODetail({
          poNumber: po.poNumber || `PO #${selectedPOId}`,
          supplierName: po.supplierName || 'Unknown Supplier',
        });

        if (po.items && po.items.length > 0) {
          const poItems: FormItem[] = po.items.map(item => {
            const outstanding = typeof item.quantityPending === 'number'
              ? item.quantityPending
              : Math.max(0, (item.quantityOrdered || 0) - (item.quantityReceived || 0));
            return {
              id: crypto.randomUUID(),
              poItemId: item.id,
              itemCode: item.itemCode || '',
              itemDescription: item.description || '',
              quantityExpected: outstanding,
              quantityReceived: '',
              quantityRejected: '',
              uom: item.unitOfMeasure || 'units',
              lotNumber: '',
              notes: '',
            };
          });
          setItems(poItems);
        }
      })
      .catch(err => {
        if (cancelled) return;
        log.error('Failed to load PO detail', { error: err });
        setError(
          `Couldn't load PO ${selectedPOId.slice(0, 8)}… — supplier and items weren't pre-filled. Please refresh or pick a PO manually.`
        );
      });

    return () => { cancelled = true; };
  }, [selectedPOId]);

  // Item management
  const addItem = () => {
    setItems([
      ...items,
      {
        id: crypto.randomUUID(),
        itemCode: '',
        itemDescription: '',
        quantityExpected: '',
        quantityReceived: '',
        quantityRejected: '',
        uom: 'units',
        lotNumber: '',
        notes: '',
      },
    ]);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const updateItem = (index: number, field: keyof FormItem, value: string | number) => {
    setItems(items.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  // Validation
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!supplierId) {
      errors.supplierId = 'Supplier is required';
    }

    if (!warehouseId) {
      errors.warehouseId = 'Warehouse is required';
    }

    // Validate items
    const validItems = items.filter(
      (item) =>
        item.itemDescription.trim() &&
        item.quantityReceived !== '' &&
        Number(item.quantityReceived) >= 0 &&
        item.uom
    );

    if (validItems.length === 0) {
      errors.items = 'At least one item with received quantity is required';
    }

    items.forEach((item, index) => {
      if (item.itemDescription.trim() && item.itemDescription.length < 3) {
        errors[`item_${index}_description`] = 'Description must be at least 3 characters';
      }
      if (item.quantityReceived !== '' && Number(item.quantityReceived) < 0) {
        errors[`item_${index}_received`] = 'Quantity received cannot be negative';
      }
      if (item.quantityRejected !== '' && Number(item.quantityRejected) < 0) {
        errors[`item_${index}_rejected`] = 'Quantity rejected cannot be negative';
      }
    });

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const validItems = items
        .filter(
          (item) =>
            item.itemDescription.trim() &&
            item.quantityReceived !== '' &&
            Number(item.quantityReceived) >= 0
        )
        .map((item) => ({
          poItemId: item.poItemId,
          itemCode: item.itemCode || undefined,
          itemDescription: item.itemDescription,
          quantityExpected: item.quantityExpected !== '' ? Number(item.quantityExpected) : undefined,
          quantityReceived: Number(item.quantityReceived),
          quantityRejected: item.quantityRejected !== '' ? Number(item.quantityRejected) : 0,
          uom: item.uom,
          lotNumber: item.lotNumber || undefined,
          notes: item.notes || undefined,
        }));

      const response = await fetch('/api/procurement/grn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseOrderId: selectedPOId || undefined,
          supplierId,
          warehouseId,
          deliveryNoteNumber: deliveryNoteNumber || undefined,
          carrier: carrier || undefined,
          vehicleNumber: vehicleNumber || undefined,
          receivingBay: receivingBay || undefined,
          inspectionRequired,
          notes: notes || undefined,
          items: validItems,
        }),
      });

      const data = await response.json();

      if (data.success) {
        router.push(`/procurement/grn/${data.data.id}`);
      } else {
        setError(data.error?.message || 'Failed to create GRN');
      }
    } catch (err) {
      log.error('Failed to create GRN', { error: err });
      setError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculate totals
  const totals = items.reduce(
    (acc, item) => {
      const received = item.quantityReceived !== '' ? Number(item.quantityReceived) : 0;
      const rejected = item.quantityRejected !== '' ? Number(item.quantityRejected) : 0;
      return {
        received: acc.received + received,
        rejected: acc.rejected + rejected,
        accepted: acc.accepted + (received - rejected),
      };
    },
    { received: 0, rejected: 0, accepted: 0 }
  );

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => router.back()}
                  className="p-2 hover:bg-[var(--ff-bg-hover)] rounded-lg transition-colors"
                >
                  <ArrowLeft className="h-5 w-5 text-[var(--ff-text-secondary)]" />
                </button>
                <div className="p-2 rounded-lg bg-emerald-500/20">
                  <PackageCheck className="h-6 w-6 text-emerald-400" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
                    New Goods Receipt
                  </h1>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    Receive goods from delivery
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 max-w-5xl mx-auto">
          {/* Error display */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
              <span className="text-red-400">{error}</span>
            </div>
          )}

          {/* Purchase Order Selection */}
          <div className={`mb-6 p-4 border rounded-lg ${isLinkedFromPO ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]'}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-[var(--ff-text-primary)]">
                {isLinkedFromPO ? 'Linked Purchase Order' : 'Source Purchase Order (Optional)'}
              </h3>
              {isLinkedFromPO && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <PackageCheck className="h-3.5 w-3.5" />
                  Linked from PO
                </span>
              )}
            </div>
            {isLinkedFromPO && selectedPOId && (() => {
              const poFromList = purchaseOrders.find((p) => p.id === selectedPOId);
              const poNumber = poFromList?.poNumber || linkedPODetail?.poNumber;
              const supplierName = poFromList?.supplierName || linkedPODetail?.supplierName;
              const headerText = poNumber && supplierName
                ? `GRN linked to ${poNumber} — ${supplierName}`
                : poNumber
                  ? `GRN linked to ${poNumber}`
                  : `GRN linked to PO #${selectedPOId}`;
              return (
                <div className="mb-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <p className="text-sm text-emerald-400 font-medium">{headerText}</p>
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">
                    PO and supplier are pre-filled from the source purchase order and cannot be changed.
                  </p>
                </div>
              );
            })()}
            <div className="relative">
              <select
                value={selectedPOId}
                onChange={(e) => setSelectedPOId(e.target.value)}
                disabled={isLoadingData || isLinkedFromPO}
                className={`w-full px-4 py-2 border rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50 appearance-none ${
                  isLinkedFromPO
                    ? 'bg-[var(--ff-bg-tertiary)] border-emerald-500/30 opacity-75 cursor-not-allowed'
                    : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]'
                }`}
              >
                <option value="">No linked PO (standalone receipt)</option>
                {purchaseOrders.map((po) => {
                  const outstanding = (po.totalOrdered ?? 0) - (po.totalReceived ?? 0);
                  const fullyReceived = po.grnCount && po.grnCount > 0 && outstanding <= 0;
                  const partiallyReceived = po.grnCount && po.grnCount > 0 && outstanding > 0;
                  let label = `${po.poNumber} — ${po.supplierName} (${po.itemCount} items)`;
                  if (fullyReceived) {
                    label += ' [Fully Received]';
                  } else if (partiallyReceived) {
                    label += ` [${outstanding} outstanding]`;
                  }
                  return (
                    <option
                      key={po.id}
                      value={po.id}
                      disabled={!!fullyReceived}
                      className={fullyReceived ? 'text-[var(--ff-text-tertiary)]' : ''}
                    >
                      {label}
                    </option>
                  );
                })}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)] pointer-events-none" />
            </div>
            {!isLinkedFromPO && (
              <p className="mt-2 text-xs text-[var(--ff-text-tertiary)]">
                Fully received POs are disabled. POs with outstanding quantities can receive additional GRNs.
              </p>
            )}
          </div>

          {/* Delivery Info */}
          <div className="mb-6 p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
            <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-4">
              Delivery Information
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {/* Supplier */}
              <div>
                <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                  Supplier <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <Truck className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
                  <select
                    value={supplierId}
                    onChange={(e) => setSupplierId(Number(e.target.value))}
                    required
                    disabled={isLoadingData || !!selectedPOId}
                    className={`w-full pl-10 pr-10 py-2 bg-[var(--ff-bg-tertiary)] border rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50 appearance-none ${
                      fieldErrors.supplierId ? 'border-red-500' : 'border-[var(--ff-border-light)]'
                    }`}
                  >
                    <option value="">Select supplier</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.companyName || s.name || `Supplier ${s.id}`}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)] pointer-events-none" />
                </div>
                {fieldErrors.supplierId && (
                  <span className="text-xs text-red-400">{fieldErrors.supplierId}</span>
                )}
              </div>

              {/* Warehouse */}
              <div>
                <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                  Receiving Warehouse <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
                  <select
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                    required
                    disabled={isLoadingData}
                    className={`w-full pl-10 pr-10 py-2 bg-[var(--ff-bg-tertiary)] border rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50 appearance-none ${
                      fieldErrors.warehouseId ? 'border-red-500' : 'border-[var(--ff-border-light)]'
                    }`}
                  >
                    <option value="">Select warehouse</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)] pointer-events-none" />
                </div>
                {fieldErrors.warehouseId && (
                  <span className="text-xs text-red-400">{fieldErrors.warehouseId}</span>
                )}
              </div>

              {/* Delivery Note Number */}
              <div>
                <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                  Delivery Note Number
                </label>
                <input
                  type="text"
                  value={deliveryNoteNumber}
                  onChange={(e) => setDeliveryNoteNumber(e.target.value)}
                  placeholder="e.g., DN-12345"
                  className="w-full px-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
              </div>

              {/* Carrier */}
              <div>
                <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                  Carrier
                </label>
                <input
                  type="text"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  placeholder="e.g., DHL, FedEx"
                  className="w-full px-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
              </div>

              {/* Vehicle Number */}
              <div>
                <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                  Vehicle Number
                </label>
                <input
                  type="text"
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value)}
                  placeholder="e.g., ABC 123 GP"
                  className="w-full px-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
              </div>

              {/* Receiving Bay */}
              <div>
                <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                  Receiving Bay
                </label>
                <input
                  type="text"
                  value={receivingBay}
                  onChange={(e) => setReceivingBay(e.target.value)}
                  placeholder="e.g., Bay 1"
                  className="w-full px-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
              </div>
            </div>

            {/* Inspection Required */}
            <div className="mt-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={inspectionRequired}
                  onChange={(e) => setInspectionRequired(e.target.checked)}
                  className="w-4 h-4 rounded border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-emerald-500 focus:ring-emerald-500/50"
                />
                <span className="text-sm text-[var(--ff-text-secondary)]">
                  Inspection required before accepting goods
                </span>
              </label>
            </div>
          </div>

          {/* Items */}
          <div className="mb-6 p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-[var(--ff-text-primary)]">
                Items Received
              </h3>
              <button
                type="button"
                onClick={addItem}
                className="inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300"
              >
                <Plus className="h-4 w-4" />
                Add Item
              </button>
            </div>

            {fieldErrors.items && (
              <div className="mb-4 p-2 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
                {fieldErrors.items}
              </div>
            )}

            <div className="space-y-4">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="p-4 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg"
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-sm font-medium text-[var(--ff-text-secondary)]">
                      Item {index + 1}
                    </span>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-6 gap-3">
                    {/* Item Code */}
                    <div>
                      <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">
                        Item Code
                      </label>
                      <input
                        type="text"
                        value={item.itemCode}
                        onChange={(e) => updateItem(index, 'itemCode', e.target.value)}
                        placeholder="SKU"
                        className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                      />
                    </div>

                    {/* Description */}
                    <div className="col-span-2">
                      <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">
                        Description <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={item.itemDescription}
                        onChange={(e) => updateItem(index, 'itemDescription', e.target.value)}
                        placeholder="Item description"
                        className={`w-full px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border rounded text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
                          fieldErrors[`item_${index}_description`]
                            ? 'border-red-500'
                            : 'border-[var(--ff-border-light)]'
                        }`}
                      />
                    </div>

                    {/* Qty Received */}
                    <div>
                      <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">
                        Qty Received <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={item.quantityReceived}
                        onChange={(e) =>
                          updateItem(index, 'quantityReceived', e.target.value === '' ? '' : Number(e.target.value))
                        }
                        className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                      />
                    </div>

                    {/* Qty Rejected */}
                    <div>
                      <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">
                        Qty Rejected
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={item.quantityRejected}
                        onChange={(e) =>
                          updateItem(index, 'quantityRejected', e.target.value === '' ? '' : Number(e.target.value))
                        }
                        className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                      />
                    </div>

                    {/* UOM */}
                    <div>
                      <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">
                        UOM <span className="text-red-400">*</span>
                      </label>
                      <select
                        value={item.uom}
                        onChange={(e) => updateItem(index, 'uom', e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                      >
                        {UOM_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Second row - lot number and notes */}
                  <div className="grid grid-cols-3 gap-3 mt-3">
                    <div>
                      <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">
                        Lot/Batch Number
                      </label>
                      <input
                        type="text"
                        value={item.lotNumber}
                        onChange={(e) => updateItem(index, 'lotNumber', e.target.value)}
                        placeholder="LOT-12345"
                        className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">
                        Notes
                      </label>
                      <input
                        type="text"
                        value={item.notes}
                        onChange={(e) => updateItem(index, 'notes', e.target.value)}
                        placeholder="Any notes about this item"
                        className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="mt-4 pt-4 border-t border-[var(--ff-border-light)]">
              <div className="flex justify-end gap-6 text-sm">
                <div className="text-[var(--ff-text-secondary)]">
                  Total Received: <span className="font-medium text-[var(--ff-text-primary)]">{totals.received}</span>
                </div>
                <div className="text-[var(--ff-text-secondary)]">
                  Total Rejected: <span className="font-medium text-red-400">{totals.rejected}</span>
                </div>
                <div className="text-[var(--ff-text-secondary)]">
                  Total Accepted: <span className="font-medium text-green-400">{totals.accepted}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="mb-6 p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
            <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-4">Notes</h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Any additional notes about this receipt..."
              className="w-full px-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Create GRN
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}
