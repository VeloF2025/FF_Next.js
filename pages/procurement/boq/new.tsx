/**
 * Create New BOQ Page
 * Allows users to create a new Bill of Quantities by entering details or uploading Excel
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import { ArrowLeft, Upload, FileSpreadsheet, Plus, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import BOQUpload from '@/components/procurement/boq/BOQUpload';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';

interface Project {
  id: string;
  name: string;
}

interface BOQItem {
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  category: string;
}

export default function NewBOQPage() {
  const router = useRouter();
  const { projectId: queryProjectId } = router.query;

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [items, setItems] = useState<BOQItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'manual' | 'upload'>('upload');

  // Load projects for selector
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
        log.error('Failed to load projects:', { data: error }, 'NewBOQPage');
      } finally {
        setIsLoadingProjects(false);
      }
    };
    loadProjects();
  }, []);

  // Set project from query params
  useEffect(() => {
    if (queryProjectId && typeof queryProjectId === 'string') {
      setSelectedProjectId(queryProjectId);
    }
  }, [queryProjectId]);

  const addItem = () => {
    setItems([...items, {
      description: '',
      unit: 'unit',
      quantity: 1,
      unitPrice: 0,
      category: 'Materials'
    }]);
  };

  const updateItem = (index: number, field: keyof BOQItem, value: string | number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleManualSubmit = async () => {
    if (!title.trim()) {
      toast.error('Please enter a BOQ title');
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

    setIsSubmitting(true);
    try {
      // First create the BOQ record
      const boqResponse = await fetch('/api/procurement/boq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId,
          title,
          description,
          items: items.map((item, index) => ({
            ...item,
            itemCode: `ITEM-${index + 1}`,
            totalPrice: item.quantity * item.unitPrice
          }))
        })
      });

      if (!boqResponse.ok) {
        const error = await boqResponse.json();
        throw new Error(error.message || 'Failed to create BOQ');
      }

      toast.success('BOQ created successfully!');
      router.push('/procurement/boq');
    } catch (error) {
      log.error('Failed to create BOQ:', { data: error }, 'NewBOQPage');
      toast.error(error instanceof Error ? error.message : 'Failed to create BOQ');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUploadComplete = (result: { boqId: string; itemsCreated: number }) => {
    toast.success(`BOQ imported with ${result.itemsCreated} items!`);
    router.push('/procurement/boq');
  };

  const calculateTotal = () => {
    return items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-tertiary)]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="mb-8">
            <button
              onClick={() => router.back()}
              className="flex items-center text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] mb-4"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to BOQ List
            </button>
            <h1 className="text-3xl font-bold text-[var(--ff-text-primary)]">Create Bill of Quantities</h1>
            <p className="mt-2 text-[var(--ff-text-secondary)]">
              Add items manually or upload an Excel file
            </p>
          </div>

          {/* Project Selection */}
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6 mb-6">
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Project Selection</h2>
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
                  BOQ Title <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Phase 1 Materials"
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md focus:ring-blue-500 focus:border-blue-500 placeholder:text-[var(--ff-text-tertiary)]"
                />
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Optional description..."
                className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md focus:ring-blue-500 focus:border-blue-500 placeholder:text-[var(--ff-text-tertiary)]"
              />
            </div>
          </div>

          {/* Tab Selection */}
          <div className="flex space-x-1 bg-[var(--ff-bg-tertiary)] p-1 rounded-lg mb-6 w-fit">
            <button
              onClick={() => setActiveTab('upload')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center ${
                activeTab === 'upload'
                  ? 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] shadow-sm'
                  : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload Excel
            </button>
            <button
              onClick={() => setActiveTab('manual')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center ${
                activeTab === 'manual'
                  ? 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] shadow-sm'
                  : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Manual Entry
            </button>
          </div>

          {/* Upload Tab */}
          {activeTab === 'upload' && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Upload BOQ File</h2>
              {!selectedProjectId ? (
                <div className="text-center py-8 text-[var(--ff-text-secondary)]">
                  <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
                  <p>Please select a project first to enable file upload</p>
                </div>
              ) : (
                <BOQUpload
                  onUploadComplete={handleUploadComplete}
                  onUploadError={(error) => toast.error(error)}
                  enableEnhancedImport={true}
                  createBudgetItems={true}
                  createMaterials={true}
                />
              )}
            </div>
          )}

          {/* Manual Entry Tab */}
          {activeTab === 'manual' && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Line Items</h2>
                <Button onClick={addItem} size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Item
                </Button>
              </div>

              {items.length === 0 ? (
                <div className="text-center py-8 text-[var(--ff-text-secondary)]">
                  <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
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
                  {/* Table Header */}
                  <div className="grid grid-cols-12 gap-2 text-sm font-medium text-[var(--ff-text-secondary)] px-2">
                    <div className="col-span-4">Description</div>
                    <div className="col-span-2">Category</div>
                    <div className="col-span-1">Unit</div>
                    <div className="col-span-2">Qty</div>
                    <div className="col-span-2">Unit Price</div>
                    <div className="col-span-1"></div>
                  </div>

                  {/* Items */}
                  {items.map((item, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-4">
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => updateItem(index, 'description', e.target.value)}
                          placeholder="Item description"
                          className="w-full px-2 py-1.5 text-sm bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md placeholder:text-[var(--ff-text-tertiary)]"
                        />
                      </div>
                      <div className="col-span-2">
                        <select
                          value={item.category}
                          onChange={(e) => updateItem(index, 'category', e.target.value)}
                          className="w-full px-2 py-1.5 text-sm bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md"
                        >
                          <option value="Materials">Materials</option>
                          <option value="Equipment">Equipment</option>
                          <option value="Labor">Labor</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      <div className="col-span-1">
                        <input
                          type="text"
                          value={item.unit}
                          onChange={(e) => updateItem(index, 'unit', e.target.value)}
                          placeholder="m"
                          className="w-full px-2 py-1.5 text-sm bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md placeholder:text-[var(--ff-text-tertiary)]"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateItem(index, 'quantity', Number(e.target.value))}
                          min="0"
                          className="w-full px-2 py-1.5 text-sm bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          value={item.unitPrice}
                          onChange={(e) => updateItem(index, 'unitPrice', Number(e.target.value))}
                          min="0"
                          step="0.01"
                          className="w-full px-2 py-1.5 text-sm bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md"
                        />
                      </div>
                      <div className="col-span-1">
                        <button
                          onClick={() => removeItem(index)}
                          className="p-1.5 text-red-400 hover:bg-red-500/10 rounded"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Total */}
                  <div className="flex justify-end pt-4 border-t border-[var(--ff-border-light)]">
                    <div className="text-right">
                      <p className="text-sm text-[var(--ff-text-secondary)]">Total Value</p>
                      <p className="text-xl font-bold text-[var(--ff-text-primary)]">
                        R {calculateTotal().toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Submit Button */}
              {items.length > 0 && (
                <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-[var(--ff-border-light)]">
                  <Button
                    variant="outline"
                    onClick={() => router.push('/procurement/boq')}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleManualSubmit}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Creating...
                      </>
                    ) : (
                      'Create BOQ'
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
