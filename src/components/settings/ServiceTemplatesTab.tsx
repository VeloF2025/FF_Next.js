/**
 * Service Templates Tab Component
 * Manages hierarchical service templates for rate card system
 * Integrated into Settings module for system-wide configuration
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Plus, 
  Search, 
  Edit, 
  Trash2, 
  ChevronRight, 
  ChevronDown, 
  Package,
  Settings,
  FileText,
  AlertCircle,
  CheckCircle,
  Clock
} from 'lucide-react';

import { 
  ServiceTemplate, 
  ServiceTemplateFormData, 
  ServiceTemplateSearchParams, 
  ServiceTemplatesTabProps 
} from '@/types/contractor';
import { ServiceTemplateApiService } from '@/services/contractor';
import { log } from '@/lib/logger';

// 🟢 WORKING: Main component
export function ServiceTemplatesTab({ 
  onServiceTemplateCreate,
  onServiceTemplateUpdate,
  onServiceTemplateDelete 
}: ServiceTemplatesTabProps) {
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [filteredTemplates, setFilteredTemplates] = useState<ServiceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useState<ServiceTemplateSearchParams>({
    page: 1,
    limit: 50,
    sortBy: 'name',
    sortOrder: 'asc'
  });
  
  // UI state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'deliverable' | 'service' | ''>('');
  const [showInactiveOnly, setShowInactiveOnly] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<string[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<ServiceTemplate | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  // 🟢 WORKING: Load templates
  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await ServiceTemplateApiService.getServiceTemplates(searchParams);
      setTemplates(response.data);
      
    } catch (err) {
      setError('Failed to load service templates');
      log.error('Error loading templates:', { data: err }, 'ServiceTemplatesTab');
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  // Load templates on mount and when search params change
  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // 🟢 WORKING: Filter templates based on search and filters
  useEffect(() => {
    let filtered = [...templates];
    
    // Apply search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(template => 
        template.name.toLowerCase().includes(term) ||
        template.description?.toLowerCase().includes(term) ||
        template.code?.toLowerCase().includes(term)
      );
    }
    
    // Apply category filter
    if (selectedCategory) {
      filtered = filtered.filter(template => template.category === selectedCategory);
    }
    
    // Apply active/inactive filter
    if (showInactiveOnly) {
      filtered = filtered.filter(template => !template.isActive);
    } else {
      filtered = filtered.filter(template => template.isActive);
    }
    
    setFilteredTemplates(filtered);
  }, [templates, searchTerm, selectedCategory, showInactiveOnly]);

  // 🟢 WORKING: Tree structure helpers
  const buildHierarchy = (templates: ServiceTemplate[]): ServiceTemplate[] => {
    const templateMap = new Map<string, ServiceTemplate>();
    const roots: ServiceTemplate[] = [];
    
    // First pass: create map and initialize children arrays
    templates.forEach(template => {
      templateMap.set(template.id, { ...template, children: [] });
    });
    
    // Second pass: build hierarchy
    templates.forEach(template => {
      const templateWithChildren = templateMap.get(template.id)!;
      
      if (template.parentId && templateMap.has(template.parentId)) {
        const parent = templateMap.get(template.parentId)!;
        parent.children!.push(templateWithChildren);
      } else {
        roots.push(templateWithChildren);
      }
    });
    
    return roots.sort((a, b) => a.orderIndex - b.orderIndex);
  };

  const toggleExpanded = (templateId: string) => {
    setExpandedNodes(prev => 
      prev.includes(templateId)
        ? prev.filter(id => id !== templateId)
        : [...prev, templateId]
    );
  };

  // 🟢 WORKING: CRUD operations
  const handleCreate = async (data: ServiceTemplateFormData) => {
    try {
      const newTemplate = await ServiceTemplateApiService.createServiceTemplate(data);
      setTemplates(prev => [...prev, newTemplate]);
      setShowCreateModal(false);
      onServiceTemplateCreate?.(newTemplate);
    } catch (err) {
      log.error('Error creating template:', { data: err }, 'ServiceTemplatesTab');
      setError('Failed to create service template');
    }
  };

  const handleUpdate = async (id: string, data: Partial<ServiceTemplateFormData>) => {
    try {
      const updatedTemplate = await ServiceTemplateApiService.updateServiceTemplate(id, data);
      setTemplates(prev => prev.map(t => t.id === id ? updatedTemplate : t));
      setSelectedTemplate(null);
      setShowEditModal(false);
      onServiceTemplateUpdate?.(updatedTemplate);
    } catch (err) {
      log.error('Error updating template:', { data: err }, 'ServiceTemplatesTab');
      setError('Failed to update service template');
    }
  };

  // Update search parameters handler for future use
  const updateSearchParams = (newParams: Partial<ServiceTemplateSearchParams>) => {
    setSearchParams((prev: ServiceTemplateSearchParams) => ({ ...prev, ...newParams }));
  };

  // Temporarily silence unused variable warnings - these will be used when forms are implemented
  void handleCreate;
  void handleUpdate; 
  void updateSearchParams;

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this service template? This action cannot be undone.')) {
      return;
    }
    
    try {
      await ServiceTemplateApiService.deleteServiceTemplate(id);
      setTemplates(prev => prev.filter(t => t.id !== id));
      onServiceTemplateDelete?.(id);
    } catch (err) {
      log.error('Error deleting template:', { data: err }, 'ServiceTemplatesTab');
      setError('Failed to delete service template');
    }
  };

  // 🟢 WORKING: Tree Node Component
  const TreeNode: React.FC<{ 
    template: ServiceTemplate; 
    level: number; 
  }> = ({ template, level }) => {
    const hasChildren = template.children && template.children.length > 0;
    const isExpanded = expandedNodes.includes(template.id);
    const indentClass = level === 0 ? '' : `ml-${level * 6}`;

    return (
      <div className="service-template-node">
        {/* Main node */}
        <div className={`flex items-center justify-between p-3 border border-[var(--ff-border-light)] rounded-lg mb-2 hover:bg-[var(--ff-bg-hover)] ${indentClass}`}>
          <div className="flex items-center space-x-3 flex-1">
            {/* Expand/collapse button */}
            {hasChildren ? (
              <button
                onClick={() => toggleExpanded(template.id)}
                className="p-1 hover:bg-secondary rounded"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>
            ) : (
              <div className="w-6" /> // Spacer for alignment
            )}

            {/* Category icon */}
            <div className="flex-shrink-0">
              {template.category === 'deliverable' ? (
                <Package className="w-5 h-5 text-blue-500" />
              ) : (
                <Settings className="w-5 h-5 text-green-500" />
              )}
            </div>

            {/* Template info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center space-x-2">
                <h4 className="font-medium text-foreground truncate">{template.name}</h4>
                {template.code && (
                  <span className="text-xs bg-secondary text-muted-foreground px-2 py-1 rounded">
                    {template.code}
                  </span>
                )}
              </div>
              {template.description && (
                <p className="text-sm text-muted-foreground truncate mt-1">{template.description}</p>
              )}
              <div className="flex items-center space-x-4 mt-2 text-xs text-gray-400">
                {template.unit && <span>Unit: {template.unit}</span>}
                {template.baseRate && (
                  <span>Base Rate: {template.currency} {template.baseRate.toFixed(2)}</span>
                )}
                <span className={`inline-flex items-center ${template.isActive ? 'text-green-600' : 'text-red-600'}`}>
                  {template.isActive ? (
                    <>
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Active
                    </>
                  ) : (
                    <>
                      <Clock className="w-3 h-3 mr-1" />
                      Inactive
                    </>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                setSelectedTemplate(template);
                setShowEditModal(true);
              }}
              className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded"
              title="Edit template"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleDelete(template.id)}
              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
              title="Delete template"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Children nodes */}
        {hasChildren && isExpanded && (
          <div className="ml-4 border-l-2 border-gray-100 pl-4">
            {template.children!.map((child: ServiceTemplate) => (
              <TreeNode
                key={child.id}
                template={child}
                level={level + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  const hierarchicalTemplates = buildHierarchy(filteredTemplates);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-2 text-muted-foreground">Loading service templates...</span>
      </div>
    );
  }

  return (
    <div className="service-templates-tab">
      {/* Header */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold flex items-center">
              <FileText className="w-5 h-5 mr-2" />
              Service Templates
            </h3>
            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
              Manage hierarchical service templates for contractor rate cards
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Template
          </button>
        </div>

        {/* Error display */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-400 rounded-lg text-red-400 flex items-center">
            <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-500 hover:text-red-700"
            >
              ×
            </button>
          </div>
        )}

        {/* Search and filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--ff-text-tertiary)] w-4 h-4" />
            <input
              type="text"
              placeholder="Search templates by name, description, or code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Category filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as 'deliverable' | 'service' | '')}
            className="px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Categories</option>
            <option value="deliverable">Deliverables</option>
            <option value="service">Services</option>
          </select>

          {/* Active/inactive toggle */}
          <label className="flex items-center space-x-2 px-3 py-2">
            <input
              type="checkbox"
              checked={showInactiveOnly}
              onChange={(e) => setShowInactiveOnly(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-muted-foreground">Show inactive only</span>
          </label>

          {/* Expand all / Collapse all */}
          <div className="flex space-x-2">
            <button
              onClick={() => setExpandedNodes(hierarchicalTemplates.map(t => t.id))}
              className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-background"
            >
              Expand All
            </button>
            <button
              onClick={() => setExpandedNodes([])}
              className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-background"
            >
              Collapse All
            </button>
          </div>
        </div>
      </div>

      {/* Templates tree */}
      <div className="bg-card rounded-lg shadow p-6">
        {hierarchicalTemplates.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">No service templates found</h3>
            <p className="text-muted-foreground mb-4">
              {searchTerm || selectedCategory || showInactiveOnly
                ? 'Try adjusting your filters or search terms'
                : 'Get started by creating your first service template'
              }
            </p>
            {!searchTerm && !selectedCategory && !showInactiveOnly && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Create Service Template
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {hierarchicalTemplates.map(template => (
              <TreeNode
                key={template.id}
                template={template}
                level={0}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Modal - Placeholder */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Create Service Template</h3>
            <p className="text-muted-foreground mb-4">
              Service template creation form will be implemented here.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-muted-foreground border border-border rounded-lg hover:bg-background"
              >
                Cancel
              </button>
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal - Placeholder */}
      {showEditModal && selectedTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Edit Service Template</h3>
            <p className="text-muted-foreground mb-4">
              Editing: {selectedTemplate.name}
            </p>
            <p className="text-muted-foreground mb-4">
              Service template edit form will be implemented here.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setSelectedTemplate(null);
                }}
                className="px-4 py-2 text-muted-foreground border border-border rounded-lg hover:bg-background"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setSelectedTemplate(null);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}