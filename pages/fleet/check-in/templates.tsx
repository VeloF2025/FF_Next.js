/**
 * Fleet Check-In Templates Admin Page
 * Manage checklist templates and items
 */

import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import {
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
  GripVertical,
  AlertTriangle,
  CheckCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { AppLayout } from '@/components/layout';
import type {
  CheckTemplate,
  CheckTemplateWithItems,
  CheckItem,
  CheckItemCategory,
} from '@/modules/fleet/types/check-in.types';

export default function CheckInTemplatesPage() {
  const [templates, setTemplates] = useState<CheckTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<CheckTemplateWithItems | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit states
  const [isEditing, setIsEditing] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<CheckItemCategory>('safety');
  const [newItemCritical, setNewItemCritical] = useState(false);
  const [showNewItemForm, setShowNewItemForm] = useState(false);

  // Load templates
  useEffect(() => {
    async function loadTemplates() {
      try {
        const response = await fetch('/api/fleet/check-in/templates');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || data.message);
        setTemplates(data.data || data);

        // Auto-select default template
        const defaultTemplate = data.find((t: CheckTemplate) => t.isDefault);
        if (defaultTemplate) {
          loadTemplateDetails(defaultTemplate.id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load templates');
      } finally {
        setIsLoading(false);
      }
    }
    loadTemplates();
  }, []);

  // Load template details
  const loadTemplateDetails = async (templateId: string) => {
    try {
      const response = await fetch(`/api/fleet/check-in/templates/${templateId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message);
      setSelectedTemplate(data.data || data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template');
    }
  };

  // Add new item
  const handleAddItem = async () => {
    if (!selectedTemplate || !newItemName.trim()) return;

    try {
      const response = await fetch('/api/fleet/check-in/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          name: newItemName.trim(),
          category: newItemCategory,
          isCritical: newItemCritical,
          displayOrder: selectedTemplate.items.length,
        }),
      });

      if (!response.ok) throw new Error('Failed to add item');

      // Reload template
      await loadTemplateDetails(selectedTemplate.id);
      setNewItemName('');
      setNewItemCategory('safety');
      setNewItemCritical(false);
      setShowNewItemForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add item');
    }
  };

  // Delete item
  const handleDeleteItem = async (itemId: string) => {
    if (!selectedTemplate) return;
    if (!confirm('Are you sure you want to delete this item?')) return;

    try {
      const response = await fetch(`/api/fleet/check-in/items/${itemId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete item');

      // Reload template
      await loadTemplateDetails(selectedTemplate.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete item');
    }
  };

  // Update item
  const handleUpdateItem = async (itemId: string, updates: Partial<CheckItem>) => {
    try {
      const response = await fetch(`/api/fleet/check-in/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) throw new Error('Failed to update item');

      if (selectedTemplate) {
        await loadTemplateDetails(selectedTemplate.id);
      }
      setEditingItem(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update item');
    }
  };

  const categoryLabels: Record<CheckItemCategory, string> = {
    safety: 'Safety',
    mechanical: 'Mechanical',
    exterior: 'Exterior',
    interior: 'Interior',
  };

  return (
    <AppLayout>
      <Head>
        <title>Check-In Templates | FibreFlow</title>
      </Head>

      <div className="p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Check-In Templates
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Configure checklist templates for vehicle inspections
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center justify-between">
            <p className="text-red-700 dark:text-red-400">{error}</p>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Templates list */}
            <div className="lg:col-span-1">
              <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg">
                <div className="p-4 border-b dark:border-gray-700">
                  <h2 className="font-semibold text-gray-900 dark:text-white">Templates</h2>
                </div>
                <div className="divide-y dark:divide-gray-700">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => loadTemplateDetails(template.id)}
                      className={`w-full p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                        selectedTemplate?.id === template.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-900 dark:text-white">
                          {template.name}
                        </span>
                        {template.isDefault && (
                          <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded">
                            Default
                          </span>
                        )}
                      </div>
                      {template.description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          {template.description}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Template details */}
            <div className="lg:col-span-2">
              {selectedTemplate ? (
                <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg">
                  <div className="p-4 border-b dark:border-gray-700 flex items-center justify-between">
                    <div>
                      <h2 className="font-semibold text-gray-900 dark:text-white">
                        {selectedTemplate.name}
                      </h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {selectedTemplate.items.length} items
                      </p>
                    </div>
                    <button
                      onClick={() => setShowNewItemForm(true)}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Add Item
                    </button>
                  </div>

                  {/* New item form */}
                  {showNewItemForm && (
                    <div className="p-4 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                      <div className="flex flex-wrap gap-4">
                        <input
                          type="text"
                          value={newItemName}
                          onChange={(e) => setNewItemName(e.target.value)}
                          placeholder="Item name..."
                          className="flex-1 min-w-[200px] px-3 py-2 border border-gray-600 rounded-lg bg-[#1a1d23] text-white hover:border-gray-500"
                        />
                        <select
                          value={newItemCategory}
                          onChange={(e) => setNewItemCategory(e.target.value as CheckItemCategory)}
                          className="px-3 py-2 border border-gray-600 rounded-lg bg-[#1a1d23] text-white hover:border-gray-500"
                        >
                          {Object.entries(categoryLabels).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={newItemCritical}
                            onChange={(e) => setNewItemCritical(e.target.checked)}
                            className="rounded"
                          />
                          <span className="text-sm text-gray-700 dark:text-gray-300">Critical</span>
                        </label>
                        <div className="flex gap-2">
                          <button
                            onClick={handleAddItem}
                            className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                          >
                            <Save className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              setShowNewItemForm(false);
                              setNewItemName('');
                            }}
                            className="px-4 py-2 border rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Items list */}
                  <div className="divide-y dark:divide-gray-700">
                    {selectedTemplate.items.map((item, index) => (
                      <div
                        key={item.id}
                        className="p-4 flex items-center gap-4 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <GripVertical className="w-5 h-5 text-gray-400 cursor-grab" />

                        <div className="flex-1">
                          {editingItem === item.id ? (
                            <input
                              type="text"
                              defaultValue={item.name}
                              onBlur={(e) => handleUpdateItem(item.id, { name: e.target.value })}
                              className="w-full px-2 py-1 border rounded dark:bg-gray-800 dark:border-gray-700"
                              autoFocus
                            />
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-900 dark:text-white">
                                {item.name}
                              </span>
                              {item.isCritical && (
                                <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" />
                                  Critical
                                </span>
                              )}
                            </div>
                          )}
                          {item.description && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                              {item.description}
                            </p>
                          )}
                        </div>

                        <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 rounded capitalize">
                          {item.category || 'other'}
                        </span>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setEditingItem(item.id)}
                            className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            className="p-2 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}

                    {selectedTemplate.items.length === 0 && (
                      <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                        No items in this template. Add items above.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-8 text-center text-gray-500 dark:text-gray-400">
                  Select a template to view and edit items
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

export async function getServerSideProps() {
  return { props: {} };
}
