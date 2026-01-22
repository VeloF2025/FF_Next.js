/**
 * H&S Checklists Management
 *
 * Manage checklist templates for site audits with:
 * - Template list with item counts
 * - Create new templates
 * - Edit existing templates
 * - Category filtering
 */

import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSWR, { mutate } from 'swr';
import {
  Shield,
  ChevronLeft,
  Plus,
  Search,
  FileText,
  ClipboardCheck,
  Edit,
  Trash2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle,
  Star,
  Loader2,
  X,
  Save,
} from 'lucide-react';
import { AppLayout } from '@/components/layout';
import { notificationService } from '@/services/core/NotificationService';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ChecklistItem {
  id: string;
  item_text: string;
  category: string;
  severity: string;
  regulation_reference: string | null;
  sort_order: number;
  is_mandatory: boolean;
  requires_photo: boolean;
}

interface ChecklistTemplate {
  id: string;
  name: string;
  category: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  item_count: number;
  items?: ChecklistItem[];
  created_at: string;
  updated_at: string;
}

const CATEGORIES = [
  { value: 'site_audit', label: 'Site Audit', color: 'bg-blue-500' },
  { value: 'contractor_audit', label: 'Contractor Audit', color: 'bg-purple-500' },
  { value: 'equipment_check', label: 'Equipment Check', color: 'bg-green-500' },
  { value: 'vehicle_inspection', label: 'Vehicle Inspection', color: 'bg-orange-500' },
  { value: 'ppe_inspection', label: 'PPE Inspection', color: 'bg-yellow-500' },
  { value: 'general', label: 'General', color: 'bg-gray-500' },
];

export default function ChecklistsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data, error, isLoading } = useSWR(
    `/api/health-safety/checklists?include_items=true${categoryFilter ? `&category=${categoryFilter}` : ''}`,
    fetcher
  );

  const templates: ChecklistTemplate[] = data?.data?.templates || [];

  // Filter by search
  const filteredTemplates = templates.filter(
    (t) =>
      !searchTerm ||
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <>
      <Head>
        <title>H&S Checklists | FibreFlow</title>
      </Head>

      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/health-safety"
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-gray-500" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                <ClipboardCheck className="w-7 h-7 text-green-500" />
                H&S Checklists
              </h1>
              <p className="text-gray-500 dark:text-gray-400 mt-1">
                Manage audit checklist templates
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Template
          </button>
        </div>

        {/* Search and Category Filter */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search checklists..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-green-500"
          >
            <option value="">All Categories</option>
            {CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        {/* Templates List */}
        {isLoading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorState />
        ) : filteredTemplates.length === 0 ? (
          <EmptyState
            hasFilters={!!searchTerm || !!categoryFilter}
            onCreateClick={() => setShowCreateModal(true)}
          />
        ) : (
          <div className="space-y-4">
            {filteredTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                isExpanded={expandedId === template.id}
                onToggle={() => toggleExpand(template.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateTemplateModal onClose={() => setShowCreateModal(false)} />
      )}
    </>
  );
}

function TemplateCard({
  template,
  isExpanded,
  onToggle,
}: {
  template: ChecklistTemplate;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const category = CATEGORIES.find((c) => c.value === template.category) || CATEGORIES[5];

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className="p-4 flex items-center gap-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
        onClick={onToggle}
      >
        <div className={`p-3 rounded-lg ${category.color}/20`}>
          <FileText className={`w-6 h-6 ${category.color.replace('bg-', 'text-')}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 dark:text-white truncate">
              {template.name}
            </h3>
            {template.is_default && (
              <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-500 dark:text-gray-400">
            <span className={`px-2 py-0.5 rounded text-xs ${category.color}/20 ${category.color.replace('bg-', 'text-')}`}>
              {category.label}
            </span>
            <span>{template.item_count} items</span>
            {template.description && (
              <span className="truncate max-w-xs">{template.description}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-1 text-xs rounded ${
              template.is_active
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
            }`}
          >
            {template.is_active ? 'Active' : 'Inactive'}
          </span>
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </div>

      {/* Expanded Items */}
      {isExpanded && template.items && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-700/30">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Checklist Items
          </h4>
          {template.items.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              No items in this checklist
            </p>
          ) : (
            <div className="space-y-2">
              {template.items.map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 p-3 bg-white dark:bg-gray-800 rounded-lg"
                >
                  <span className="text-xs text-gray-400 font-mono w-6">{idx + 1}.</span>
                  <div className="flex-1">
                    <p className="text-sm text-gray-900 dark:text-white">
                      {item.item_text}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                      <span
                        className={`px-1.5 py-0.5 rounded ${
                          item.severity === 'high'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            : item.severity === 'medium'
                              ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {item.severity}
                      </span>
                      {item.is_mandatory && (
                        <span className="text-red-500">Mandatory</span>
                      )}
                      {item.requires_photo && (
                        <span className="text-blue-500">Photo required</span>
                      )}
                      {item.regulation_reference && (
                        <span className="text-purple-500">{item.regulation_reference}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-200 dark:border-gray-600">
            <button className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
              <Edit className="w-4 h-4" />
              Edit
            </button>
            <button className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateTemplateModal({ onClose }: { onClose: () => void }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    category: 'site_audit',
    description: '',
    is_default: false,
  });
  const [items, setItems] = useState<Array<{ item_text: string; severity: string; is_mandatory: boolean }>>([
    { item_text: '', severity: 'medium', is_mandatory: true },
  ]);

  const addItem = () => {
    setItems([...items, { item_text: '', severity: 'medium', is_mandatory: true }]);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const updateItem = (index: number, field: string, value: any) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      notificationService.error('Please enter a template name');
      return;
    }

    const validItems = items.filter((i) => i.item_text.trim());
    if (validItems.length === 0) {
      notificationService.error('Please add at least one checklist item');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/health-safety/checklists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          items: validItems,
        }),
      });

      const result = await response.json();

      if (result.success) {
        notificationService.success('Checklist template created');
        mutate('/api/health-safety/checklists?include_items=true');
        onClose();
      } else {
        notificationService.error(result.error || 'Failed to create template');
      }
    } catch (error) {
      notificationService.error('Failed to create template');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Create Checklist Template
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Template Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Site Safety Audit"
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Category
              </label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of this checklist..."
              rows={2}
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.is_default}
              onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-green-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Set as default template</span>
          </label>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Checklist Items *
              </label>
              <button
                type="button"
                onClick={addItem}
                className="flex items-center gap-1 text-sm text-green-600 hover:text-green-700"
              >
                <Plus className="w-4 h-4" />
                Add Item
              </button>
            </div>
            <div className="space-y-2">
              {items.map((item, index) => (
                <div key={index} className="flex items-start gap-2">
                  <span className="text-xs text-gray-400 font-mono mt-2.5 w-6">
                    {index + 1}.
                  </span>
                  <input
                    type="text"
                    value={item.item_text}
                    onChange={(e) => updateItem(index, 'item_text', e.target.value)}
                    placeholder="Checklist item text..."
                    className="flex-1 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm"
                  />
                  <select
                    value={item.severity}
                    onChange={(e) => updateItem(index, 'severity', e.target.value)}
                    className="px-2 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                  <label className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={item.is_mandatory}
                      onChange={(e) => updateItem(index, 'is_mandatory', e.target.checked)}
                      className="w-3 h-3 rounded border-gray-300 text-green-500"
                    />
                    <span className="text-gray-500 text-xs">Required</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                    disabled={items.length === 1}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white rounded-lg transition-colors"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Create Template
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-20 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse"
        />
      ))}
    </div>
  );
}

function ErrorState() {
  return (
    <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
      <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-500" />
      <p className="text-red-600 dark:text-red-400 font-medium">Failed to load checklists</p>
      <p className="text-sm text-red-500 dark:text-red-300 mt-1">Please try refreshing the page</p>
    </div>
  );
}

function EmptyState({
  hasFilters,
  onCreateClick,
}: {
  hasFilters: boolean;
  onCreateClick: () => void;
}) {
  return (
    <div className="p-12 text-center bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
      <ClipboardCheck className="w-12 h-12 mx-auto mb-4 text-gray-400" />
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">
        {hasFilters ? 'No checklists match your search' : 'No checklist templates yet'}
      </h3>
      <p className="text-gray-500 dark:text-gray-400 mb-4">
        {hasFilters
          ? 'Try adjusting your search or category filter'
          : 'Create your first checklist template to get started'}
      </p>
      {!hasFilters && (
        <button
          onClick={onCreateClick}
          className="inline-flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Template
        </button>
      )}
    </div>
  );
}

ChecklistsPage.getLayout = (page: React.ReactElement) => <AppLayout>{page}</AppLayout>;
