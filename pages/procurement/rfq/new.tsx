/**
 * Create New RFQ Page
 * Allows users to create a new Request for Quotation
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import { ArrowLeft, Plus, Trash2, Loader2, Users, Calendar, FileText, Package } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { StockItemSelector } from '@/components/procurement/StockItemSelector';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';

interface Project {
  id: string;
  name: string;
}

interface Supplier {
  id: string;
  company_name: string;
  email: string;
  status: string;
}

interface RFQItem {
  description: string;
  quantity: number;
  unit: string;
  specifications: string;
  estimatedUnitPrice: number;
  boqItemId?: string;
  stockItemId?: string;
}

export default function NewRFQPage() {
  const router = useRouter();
  const { projectId: queryProjectId, boqId } = router.query;

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [responseDeadline, setResponseDeadline] = useState<string>('');
  const [items, setItems] = useState<RFQItem[]>([]);
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([]);
  const [sourceBoqId, setSourceBoqId] = useState<string | null>(null);
  const [stockSelectorOpen, setStockSelectorOpen] = useState(false);
  const [stockSelectorItemIndex, setStockSelectorItemIndex] = useState<number | null>(null);

  // Data state
  const [projects, setProjects] = useState<Project[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importingFromBOQ, setImportingFromBOQ] = useState(false);

  // Load projects
  useEffect(() => {
    const loadProjects = async () => {
      try {
        setIsLoadingProjects(true);
        const response = await fetch('/api/projects');
        if (response.ok) {
          const data = await response.json();
          setProjects(data.data || data.projects || []);
        }
      } catch (error) {
        log.error('Failed to load projects:', { data: error }, 'NewRFQPage');
      } finally {
        setIsLoadingProjects(false);
      }
    };
    loadProjects();
  }, []);

  // Load suppliers
  useEffect(() => {
    const loadSuppliers = async () => {
      try {
        setIsLoadingSuppliers(true);
        const response = await fetch('/api/suppliers?status=active');
        if (response.ok) {
          const data = await response.json();
          setSuppliers(data.data || data.suppliers || []);
        }
      } catch (error) {
        log.error('Failed to load suppliers:', { data: error }, 'NewRFQPage');
      } finally {
        setIsLoadingSuppliers(false);
      }
    };
    loadSuppliers();
  }, []);

  // Set project from query params
  useEffect(() => {
    if (queryProjectId && typeof queryProjectId === 'string') {
      setSelectedProjectId(queryProjectId);
    }
  }, [queryProjectId]);

  // Set default deadline to 30 days from now
  useEffect(() => {
    const defaultDeadline = new Date();
    defaultDeadline.setDate(defaultDeadline.getDate() + 30);
    setResponseDeadline(defaultDeadline.toISOString().split('T')[0]);
  }, []);

  // Import items from BOQ if boqId is provided
  useEffect(() => {
    if (boqId && typeof boqId === 'string') {
      importItemsFromBOQ(boqId);
    }
  }, [boqId]);

  const importItemsFromBOQ = async (id: string) => {
    try {
      setImportingFromBOQ(true);
      // Fetch the specific BOQ by ID
      const response = await fetch(`/api/procurement/boq/${id}`);
      if (response.ok) {
        const data = await response.json();
        const boq = data.data || data;
        const boqItems = boq.items || [];

        if (boqItems.length > 0) {
          setSourceBoqId(id);
          setItems(boqItems.map((item: any) => ({
            description: item.description || item.item_description || '',
            quantity: item.quantity || 1,
            unit: item.unit || item.uom || 'unit',
            specifications: item.specifications || '',
            estimatedUnitPrice: item.unit_price || item.unitPrice || 0,
            boqItemId: item.id,
            stockItemId: item.stock_item_id || null
          })));
          // Auto-set title if not set
          if (!title && boq.title) {
            setTitle(`RFQ from BOQ: ${boq.title}`);
          }
          toast.success(`Imported ${boqItems.length} items from BOQ`);
        } else {
          toast('No items found in selected BOQ');
        }
      } else {
        // Fallback to project BOQ list if specific BOQ not found
        const listResponse = await fetch(`/api/procurement/boq?projectId=${selectedProjectId || 'all'}`);
        if (listResponse.ok) {
          const data = await listResponse.json();
          const boqs = data.data || data.boqs || [];
          if (boqs.length > 0 && boqs[0].items) {
            const firstBoq = boqs[0];
            setSourceBoqId(firstBoq.id);
            setItems(firstBoq.items.map((item: any) => ({
              description: item.description || '',
              quantity: item.quantity || 1,
              unit: item.unit || 'unit',
              specifications: '',
              estimatedUnitPrice: item.unitPrice || 0,
              boqItemId: item.id
            })));
            toast.success(`Imported ${firstBoq.items.length} items from BOQ`);
          } else {
            toast('No BOQ items found for this project');
          }
        }
      }
    } catch (error) {
      log.error('Failed to import from BOQ:', { data: error }, 'NewRFQPage');
      toast.error('Failed to import items from BOQ');
    } finally {
      setImportingFromBOQ(false);
    }
  };

  const addItem = () => {
    setItems([...items, {
      description: '',
      quantity: 1,
      unit: 'unit',
      specifications: '',
      estimatedUnitPrice: 0
    }]);
  };

  const updateItem = (index: number, field: keyof RFQItem, value: string | number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const openStockSelector = (index: number) => {
    setStockSelectorItemIndex(index);
    setStockSelectorOpen(true);
  };

  const handleStockItemSelect = (stockItem: {
    stockItemId: string;
    description: string;
    unit: string;
    estimatedUnitPrice: number;
  }) => {
    if (stockSelectorItemIndex !== null) {
      const newItems = [...items];
      newItems[stockSelectorItemIndex] = {
        ...newItems[stockSelectorItemIndex],
        description: stockItem.description,
        unit: stockItem.unit,
        estimatedUnitPrice: stockItem.estimatedUnitPrice,
        stockItemId: stockItem.stockItemId,
      };
      setItems(newItems);
    }
    setStockSelectorOpen(false);
    setStockSelectorItemIndex(null);
  };

  const toggleSupplier = (supplierId: string) => {
    setSelectedSuppliers(prev =>
      prev.includes(supplierId)
        ? prev.filter(id => id !== supplierId)
        : [...prev, supplierId]
    );
  };

  const handleSubmit = async (status: 'draft' | 'open') => {
    if (!title.trim()) {
      toast.error('Please enter an RFQ title');
      return;
    }
    if (!selectedProjectId) {
      toast.error('Please select a project');
      return;
    }
    if (items.length === 0) {
      toast.error('Please add at least one item');
      return;
    }
    if (status === 'open' && selectedSuppliers.length === 0) {
      toast.error('Please select at least one supplier to issue the RFQ');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/procurement/rfq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId,
          title,
          description,
          status,
          responseDeadline: new Date(responseDeadline).toISOString(),
          supplierIds: selectedSuppliers,
          sourceBoqId: sourceBoqId, // Link to source BOQ for tracking
          items: items.map((item, index) => ({
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            specifications: item.specifications,
            estimatedUnitPrice: item.estimatedUnitPrice,
            lineNumber: index + 1,
            boqItemId: item.boqItemId || null,
            stockItemId: item.stockItemId || null
          })),
          totalValue: items.reduce((sum, item) => sum + (item.quantity * item.estimatedUnitPrice), 0)
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to create RFQ');
      }

      const statusMessage = status === 'draft' ? 'saved as draft' : 'issued successfully';
      toast.success(`RFQ ${statusMessage}!`);
      router.push('/procurement/rfq');
    } catch (error) {
      log.error('Failed to create RFQ:', { data: error }, 'NewRFQPage');
      toast.error(error instanceof Error ? error.message : 'Failed to create RFQ');
    } finally {
      setIsSubmitting(false);
    }
  };

  const calculateTotal = () => {
    return items.reduce((sum, item) => sum + (item.quantity * item.estimatedUnitPrice), 0);
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-tertiary)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="mb-8">
            <button
              onClick={() => router.back()}
              className="flex items-center text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] mb-4"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to RFQ List
            </button>
            <h1 className="text-3xl font-bold text-[var(--ff-text-primary)]">Create Request for Quotation</h1>
            <p className="mt-2 text-[var(--ff-text-secondary)]">
              Request quotes from suppliers for your project materials
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Form - Left Column */}
            <div className="lg:col-span-2 space-y-6">
              {/* Basic Information */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
                <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4 flex items-center">
                  <FileText className="h-5 w-5 mr-2 text-[var(--ff-text-secondary)]" />
                  Basic Information
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Project <span className="text-red-400">*</span>
                    </label>
                    {isLoadingProjects ? (
                      <div className="flex items-center text-[var(--ff-text-secondary)]">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Loading projects...
                      </div>
                    ) : (
                      <select
                        value={selectedProjectId}
                        onChange={(e) => setSelectedProjectId(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">Select a project...</option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Response Deadline <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
                      <input
                        type="date"
                        value={responseDeadline}
                        onChange={(e) => setResponseDeadline(e.target.value)}
                        min={new Date().toISOString().split('T')[0]}
                        className="w-full pl-10 pr-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    RFQ Title <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Fiber Cable Supply - Phase 1"
                    className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md focus:ring-blue-500 focus:border-blue-500 placeholder:text-[var(--ff-text-tertiary)]"
                  />
                </div>
                <div className="mt-4">
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    placeholder="Provide details about the quotation requirements..."
                    className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md focus:ring-blue-500 focus:border-blue-500 placeholder:text-[var(--ff-text-tertiary)]"
                  />
                </div>
              </div>

              {/* Line Items */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Line Items</h2>
                  <div className="flex gap-2">
                    {selectedProjectId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => importItemsFromBOQ(selectedProjectId)}
                        disabled={importingFromBOQ}
                      >
                        {importingFromBOQ ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        ) : (
                          <FileText className="h-4 w-4 mr-1" />
                        )}
                        Import from BOQ
                      </Button>
                    )}
                    <Button size="sm" onClick={addItem}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add Item
                    </Button>
                  </div>
                </div>

                {items.length === 0 ? (
                  <div className="text-center py-8 text-[var(--ff-text-secondary)] border border-dashed border-[var(--ff-border-light)] rounded-lg">
                    <FileText className="h-12 w-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
                    <p>No items added yet</p>
                    <button
                      onClick={addItem}
                      className="mt-4 text-blue-400 hover:text-blue-300 font-medium"
                    >
                      Add your first item
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {items.map((item, index) => (
                      <div key={index} className="p-4 bg-[var(--ff-bg-tertiary)] rounded-lg border border-[var(--ff-border-light)]">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[var(--ff-text-secondary)]">Item #{index + 1}</span>
                            {item.stockItemId && (
                              <span className="px-1.5 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">
                                Linked to Stock
                              </span>
                            )}
                            {item.boqItemId && (
                              <span className="px-1.5 py-0.5 text-xs bg-green-500/20 text-green-400 rounded">
                                From BOQ
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openStockSelector(index)}
                              className="p-1 text-blue-400 hover:bg-blue-500/10 rounded"
                              title="Browse Stock Catalog"
                            >
                              <Package className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => removeItem(index)}
                              className="p-1 text-red-400 hover:bg-red-500/10 rounded"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                          <div className="md:col-span-2">
                            <label className="block text-xs text-[var(--ff-text-secondary)] mb-1">Description</label>
                            <input
                              type="text"
                              value={item.description}
                              onChange={(e) => updateItem(index, 'description', e.target.value)}
                              placeholder="Item description"
                              className="w-full px-2 py-1.5 text-sm bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md placeholder:text-[var(--ff-text-tertiary)]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-[var(--ff-text-secondary)] mb-1">Quantity</label>
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => updateItem(index, 'quantity', Number(e.target.value))}
                              min="1"
                              className="w-full px-2 py-1.5 text-sm bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-[var(--ff-text-secondary)] mb-1">Unit</label>
                            <input
                              type="text"
                              value={item.unit}
                              onChange={(e) => updateItem(index, 'unit', e.target.value)}
                              placeholder="m, unit, kg"
                              className="w-full px-2 py-1.5 text-sm bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md placeholder:text-[var(--ff-text-tertiary)]"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                          <div>
                            <label className="block text-xs text-[var(--ff-text-secondary)] mb-1">Specifications</label>
                            <input
                              type="text"
                              value={item.specifications}
                              onChange={(e) => updateItem(index, 'specifications', e.target.value)}
                              placeholder="Technical specs (optional)"
                              className="w-full px-2 py-1.5 text-sm bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md placeholder:text-[var(--ff-text-tertiary)]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-[var(--ff-text-secondary)] mb-1">Est. Unit Price (R)</label>
                            <input
                              type="number"
                              value={item.estimatedUnitPrice}
                              onChange={(e) => updateItem(index, 'estimatedUnitPrice', Number(e.target.value))}
                              min="0"
                              step="0.01"
                              className="w-full px-2 py-1.5 text-sm bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md"
                            />
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Total */}
                    <div className="flex justify-end pt-4 border-t border-[var(--ff-border-light)]">
                      <div className="text-right">
                        <p className="text-sm text-[var(--ff-text-secondary)]">Estimated Total</p>
                        <p className="text-xl font-bold text-[var(--ff-text-primary)]">
                          R {calculateTotal().toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Supplier Selection - Right Column */}
            <div className="space-y-6">
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
                <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4 flex items-center">
                  <Users className="h-5 w-5 mr-2 text-[var(--ff-text-secondary)]" />
                  Invite Suppliers
                </h2>
                <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
                  Select suppliers to receive this RFQ ({selectedSuppliers.length} selected)
                </p>

                {isLoadingSuppliers ? (
                  <div className="flex items-center justify-center py-8 text-[var(--ff-text-secondary)]">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Loading suppliers...
                  </div>
                ) : suppliers.length === 0 ? (
                  <div className="text-center py-8 text-[var(--ff-text-secondary)]">
                    <Users className="h-12 w-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
                    <p>No active suppliers found</p>
                    <a
                      href="/suppliers"
                      className="mt-2 text-blue-400 hover:text-blue-300 text-sm"
                    >
                      Add suppliers
                    </a>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {suppliers.map((supplier) => (
                      <label
                        key={supplier.id}
                        className={`flex items-center p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedSuppliers.includes(supplier.id)
                            ? 'border-blue-500 bg-blue-500/10'
                            : 'border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedSuppliers.includes(supplier.id)}
                          onChange={() => toggleSupplier(supplier.id)}
                          className="h-4 w-4 text-blue-600 rounded border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] focus:ring-blue-500"
                        />
                        <div className="ml-3">
                          <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                            {supplier.company_name}
                          </p>
                          <p className="text-xs text-[var(--ff-text-secondary)]">{supplier.email}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
                <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Actions</h2>
                <div className="space-y-3">
                  <Button
                    className="w-full"
                    onClick={() => handleSubmit('open')}
                    disabled={isSubmitting || items.length === 0}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Creating...
                      </>
                    ) : (
                      'Issue RFQ'
                    )}
                  </Button>
                  <button
                    className="w-full px-4 py-2 text-sm font-medium text-[var(--ff-text-primary)] bg-transparent border border-[var(--ff-border-light)] rounded-md hover:bg-[var(--ff-bg-tertiary)] disabled:opacity-50"
                    onClick={() => handleSubmit('draft')}
                    disabled={isSubmitting}
                  >
                    Save as Draft
                  </button>
                  <button
                    className="w-full px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] bg-transparent border border-[var(--ff-border-light)] rounded-md hover:bg-[var(--ff-bg-tertiary)]"
                    onClick={() => router.push('/procurement/rfq')}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stock Item Selector Modal */}
      <StockItemSelector
        isOpen={stockSelectorOpen}
        onClose={() => {
          setStockSelectorOpen(false);
          setStockSelectorItemIndex(null);
        }}
        onSelect={handleStockItemSelect}
      />
    </AppLayout>
  );
}
