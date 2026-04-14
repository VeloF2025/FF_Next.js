// 🟢 WORKING: Template list component for workflow template management
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Search, 
  Filter, 
  Plus, 
  Edit3, 
  Copy, 
  Trash2, 
  Download, 
  Upload,
  MoreVertical,
  FileText,
  Calendar,
  Tag,
  Users,
  AlertCircle
} from 'lucide-react';
import { workflowManagementService } from '../../services/WorkflowManagementService';
import { workflowTemplateService } from '../../services/WorkflowTemplateService';
import { log } from '@/lib/logger';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type {
  WorkflowTemplate,
  WorkflowTemplateQuery,
  WorkflowCategory,
  WorkflowStatus,
} from '../../types/workflow.types';
import type {
  TemplateListState
} from '../../types/portal.types';

interface TemplateListProps {
  onTemplateSelect?: (template: WorkflowTemplate) => void;
  onTemplateEdit?: (templateId: string) => void;
  selectedTemplateId?: string;
}

// Template card component
interface TemplateCardProps {
  template: WorkflowTemplate;
  isSelected?: boolean;
  onSelect?: (template: WorkflowTemplate) => void;
  onEdit?: (templateId: string) => void;
  onDuplicate?: (templateId: string) => void;
  onDelete?: (templateId: string) => void;
  onExport?: (templateId: string) => void;
}

function TemplateCard({
  template,
  isSelected = false,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
  onExport
}: TemplateCardProps) {
  const [showMenu, setShowMenu] = useState(false);

  const getStatusColor = (status: WorkflowStatus) => {
    switch (status) {
      case 'active': return 'bg-green-500/20 text-green-400';
      case 'draft': return 'bg-yellow-500/20 text-yellow-400';
      case 'archived': return 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]';
      default: return 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]';
    }
  };

  const getCategoryColor = (category: WorkflowCategory) => {
    switch (category) {
      case 'project': return 'bg-blue-500/20 text-blue-400';
      case 'maintenance': return 'bg-purple-500/20 text-purple-400';
      case 'emergency': return 'bg-red-500/20 text-red-400';
      case 'telecommunications': return 'bg-cyan-500/20 text-cyan-400';
      default: return 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]';
    }
  };

  return (
    <div
      className={`relative bg-[var(--ff-bg-secondary)] rounded-lg border-2 transition-all duration-200 hover:shadow-md cursor-pointer ${
        isSelected
          ? 'border-blue-500 shadow-md'
          : 'border-[var(--ff-border-light)] hover:border-[var(--ff-border-light)]'
      }`}
      onClick={() => onSelect?.(template)}
    >
      {/* Template Header */}
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2 mb-2">
              <FileText className="w-4 h-4 text-[var(--ff-text-tertiary)] flex-shrink-0" />
              <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] truncate">
                {template.name}
              </h3>
              {template.isDefault && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-500/20 text-indigo-400">
                  Default
                </span>
              )}
            </div>

            {template.description && (
              <p className="text-xs text-[var(--ff-text-secondary)] mb-3 line-clamp-2">
                {template.description}
              </p>
            )}

            <div className="flex items-center space-x-3 text-xs text-[var(--ff-text-tertiary)]">
              <span className="flex items-center space-x-1">
                <Calendar className="w-3 h-3" />
                <span>v{template.version}</span>
              </span>
              <span className="flex items-center space-x-1">
                <Users className="w-3 h-3" />
                <span>{template.projectCount || 0} projects</span>
              </span>
            </div>
          </div>

          {/* Actions Menu */}
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              aria-label="Template actions"
            >
              <MoreVertical className="w-4 h-4" />
            </Button>

            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 top-8 z-20 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-md shadow-lg py-1 w-32">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit?.(template.id);
                      setShowMenu(false);
                    }}
                    className="w-full justify-start text-xs"
                  >
                    <Edit3 className="w-3 h-3 mr-2" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicate?.(template.id);
                      setShowMenu(false);
                    }}
                    className="w-full justify-start text-xs"
                  >
                    <Copy className="w-3 h-3 mr-2" />
                    Duplicate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onExport?.(template.id);
                      setShowMenu(false);
                    }}
                    className="w-full justify-start text-xs"
                  >
                    <Download className="w-3 h-3 mr-2" />
                    Export
                  </Button>
                  {!template.isSystem && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete?.(template.id);
                        setShowMenu(false);
                      }}
                      className="w-full justify-start text-xs text-red-400 hover:bg-red-500/20"
                    >
                      <Trash2 className="w-3 h-3 mr-2" />
                      Delete
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Template Footer */}
      <div className="px-4 py-3 border-t border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(template.status)}`}>
              {template.status.charAt(0).toUpperCase() + template.status.slice(1)}
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getCategoryColor(template.category)}`}>
              {template.category.charAt(0).toUpperCase() + template.category.slice(1)}
            </span>
          </div>

          {template.tags.length > 0 && (
            <div className="flex items-center space-x-1">
              <Tag className="w-3 h-3 text-[var(--ff-text-tertiary)]" />
              <span className="text-xs text-[var(--ff-text-tertiary)]">
                {template.tags.length} tag{template.tags.length > 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Main TemplateList component
export function TemplateList({ 
  onTemplateSelect, 
  onTemplateEdit,
  selectedTemplateId 
}: TemplateListProps) {
  const [state, setState] = useState<TemplateListState>({
    templates: [],
    totalCount: 0,
    currentPage: 1,
    pageSize: 12,
    filter: {},
    sorting: { field: 'updatedAt', direction: 'desc' },
    selectedTemplates: [],
    isLoading: false,
    error: ''
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Load templates
  const loadTemplates = useCallback(async (page = 1) => {
    setState(prev => ({ ...prev, isLoading: true, error: '' }));

    try {
      const query = {
        ...state.filter,
        search: searchTerm || undefined,
        limit: state.pageSize,
        offset: (page - 1) * state.pageSize,
        orderBy: state.sorting.field,
        orderDirection: state.sorting.direction
      } as WorkflowTemplateQuery;

      const result = await workflowManagementService.getTemplates(query);

      setState(prev => ({
        ...prev,
        templates: result.templates,
        totalCount: result.total || result.templates.length,
        currentPage: page,
        isLoading: false
      }));
    } catch (error) {
      log.error('Error loading templates:', { data: error }, 'TemplateList');
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to load templates',
        isLoading: false
      }));
    }
  }, [state.filter, state.pageSize, state.sorting, searchTerm]);

  // Handle template actions
  const handleDuplicate = useCallback(async (templateId: string) => {
    try {
      const template = state.templates.find(t => t.id === templateId);
      if (!template) return;

      const newName = `${template.name} (Copy)`;
      await workflowManagementService.duplicateTemplate(templateId, newName, 'current-user');
      await loadTemplates(state.currentPage);
    } catch (error) {
      log.error('Error duplicating template:', { data: error }, 'TemplateList');
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to duplicate template'
      }));
    }
  }, [state.templates, state.currentPage, loadTemplates]);

  const handleDelete = useCallback(async (templateId: string) => {
    if (!confirm('Are you sure you want to delete this template? This action cannot be undone.')) {
      return;
    }

    try {
      await workflowManagementService.deleteTemplate(templateId);
      await loadTemplates(state.currentPage);
    } catch (error) {
      log.error('Error deleting template:', { data: error }, 'TemplateList');
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to delete template'
      }));
    }
  }, [state.currentPage, loadTemplates]);

  const handleExport = useCallback(async (templateId: string) => {
    try {
      const exportData = await workflowTemplateService.exportTemplate(templateId, 'current-user');
      
      // Create download link
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `workflow-template-${exportData.template.name.replace(/[^a-zA-Z0-9]/g, '-')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      log.error('Error exporting template:', { data: error }, 'TemplateList');
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to export template'
      }));
    }
  }, []);

  // Load templates on mount and when dependencies change
  useEffect(() => {
    loadTemplates(1);
  }, [state.filter, state.sorting, searchTerm]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear error after 5 seconds
  useEffect(() => {
    if (state.error) {
      const timer = setTimeout(() => {
        setState(prev => ({ ...prev, error: '' }));
      }, 5000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [state.error]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">
            Workflow Templates
          </h2>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            Manage your workflow templates and create new ones
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <Button variant="secondary" className="inline-flex items-center">
            <Upload className="w-4 h-4 mr-2" />
            Import
          </Button>
          <Button variant="primary" className="inline-flex items-center">
            <Plus className="w-4 h-4 mr-2" />
            New Template
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex items-center space-x-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search templates..."
            className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-light)] rounded-md bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`inline-flex items-center px-3 py-2 border rounded-md text-sm font-medium transition-colors ${
            showFilters
              ? 'border-blue-500 text-blue-600 bg-blue-500/20'
              : 'border-[var(--ff-border-light)] text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-hover)]'
          }`}
        >
          <Filter className="w-4 h-4 mr-2" />
          Filters
        </button>
      </div>

      {/* Error Alert */}
      {state.error && (
        <div className="p-4 bg-red-500/20 border border-red-500/30 rounded-lg flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-400">{state.error}</span>
        </div>
      )}

      {/* Templates Grid */}
      {state.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner size="md" />
          <span className="ml-3 text-[var(--ff-text-secondary)]">Loading templates...</span>
        </div>
      ) : state.templates.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
          <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">
            No templates found
          </h3>
          <p className="text-[var(--ff-text-secondary)] mb-6">
            {searchTerm || Object.keys(state.filter).length > 0
              ? 'Try adjusting your search or filters'
              : 'Get started by creating your first workflow template'}
          </p>
          <Button variant="primary" className="inline-flex items-center">
            <Plus className="w-4 h-4 mr-2" />
            Create Template
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {state.templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              isSelected={selectedTemplateId === template.id}
              onSelect={onTemplateSelect}
              onEdit={onTemplateEdit}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              onExport={handleExport}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {state.templates.length > 0 && state.totalCount > state.pageSize && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-[var(--ff-text-primary)]">
            Showing {((state.currentPage - 1) * state.pageSize) + 1} to{' '}
            {Math.min(state.currentPage * state.pageSize, state.totalCount)} of{' '}
            {state.totalCount} templates
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => loadTemplates(state.currentPage - 1)}
              disabled={state.currentPage <= 1 || state.isLoading}
              className="px-3 py-1 border border-[var(--ff-border-light)] rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--ff-bg-hover)] transition-colors"
            >
              Previous
            </button>

            <span className="px-3 py-1 text-sm text-[var(--ff-text-primary)]">
              Page {state.currentPage} of {Math.ceil(state.totalCount / state.pageSize)}
            </span>

            <button
              onClick={() => loadTemplates(state.currentPage + 1)}
              disabled={state.currentPage >= Math.ceil(state.totalCount / state.pageSize) || state.isLoading}
              className="px-3 py-1 border border-[var(--ff-border-light)] rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--ff-bg-hover)] transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 🟢 WORKING: Template list with dark mode support using CSS variables