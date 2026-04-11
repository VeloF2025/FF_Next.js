// 🟢 WORKING: Properties panel for editing workflow items
import React, { useState, useCallback } from 'react';
import { 
  Settings, 
  Save, 
  X, 
  Edit3, 
  Clock, 
  Users, 
  Tag,
  FileText,
  ChevronDown,
  ChevronRight,
  Trash2,
  Copy
} from 'lucide-react';
import { useWorkflowEditor } from '../../context/WorkflowEditorContext';
import type { WorkflowPhase, WorkflowStep, WorkflowTask } from '../../types/workflow.types';

export function PropertiesPanel() {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['basic', 'timing', 'assignments']));
  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState<any>({});

  const {
    getSelectedNode,
    updateNode,
    deleteNode,
    copyToClipboard
  } = useWorkflowEditor();

  const selectedNode = getSelectedNode();

  // Toggle section expansion
  const toggleSection = useCallback((section: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(section)) {
        newSet.delete(section);
      } else {
        newSet.add(section);
      }
      return newSet;
    });
  }, []);

  // Initialize edit values when entering edit mode
  const startEditing = useCallback(() => {
    if (selectedNode) {
      setEditValues({ ...selectedNode.data });
      setIsEditing(true);
    }
  }, [selectedNode]);

  // Cancel editing
  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditValues({});
  }, []);

  // Save changes
  const saveChanges = useCallback(() => {
    if (selectedNode) {
      updateNode(selectedNode.id, { data: editValues });
      setIsEditing(false);
      setEditValues({});
    }
  }, [selectedNode, editValues, updateNode]);

  // Update edit values
  const updateEditValue = useCallback((path: string, value: any) => {
    setEditValues((prev: any) => {
      const newValues = { ...prev };
      const keys = path.split('.');
      let current = newValues;
      
      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]!]) current[keys[i]!] = {};
        current = current[keys[i]!];
      }

      current[keys[keys.length - 1]!] = value;
      return newValues;
    });
  }, []);

  // Handle delete
  const handleDelete = useCallback(() => {
    if (selectedNode && confirm('Are you sure you want to delete this item?')) {
      deleteNode(selectedNode.id);
    }
  }, [selectedNode, deleteNode]);

  // Handle copy
  const handleCopy = useCallback(() => {
    if (selectedNode) {
      copyToClipboard(selectedNode.type, selectedNode.data);
    }
  }, [selectedNode, copyToClipboard]);


  // Render section header
  const SectionHeader = ({ section, title, icon: Icon }: {
    section: string;
    title: string;
    icon: React.ElementType;
  }) => (
    <button
      onClick={() => toggleSection(section)}
      className="w-full flex items-center justify-between p-3 text-sm font-medium text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] transition-colors"
    >
      <div className="flex items-center space-x-2">
        <Icon className="w-4 h-4" />
        <span>{title}</span>
      </div>
      {expandedSections.has(section) ? (
        <ChevronDown className="w-4 h-4" />
      ) : (
        <ChevronRight className="w-4 h-4" />
      )}
    </button>
  );

  // Render form field
  const FormField = ({ 
    label, 
    value, 
    path, 
    type = 'text', 
    options,
    multiline = false,
    readonly = false 
  }: {
    label: string;
    value: any;
    path: string;
    type?: 'text' | 'number' | 'select' | 'checkbox' | 'textarea';
    options?: { value: string; label: string }[];
    multiline?: boolean;
    readonly?: boolean;
  }) => {
    const fieldValue = isEditing ? (editValues[path] ?? value) : value;

    if (readonly || !isEditing) {
      return (
        <div className="mb-3">
          <label className="block text-xs font-medium text-[var(--ff-text-tertiary)] mb-1">
            {label}
          </label>
          <div className="text-sm text-[var(--ff-text-primary)]">
            {type === 'checkbox' ? (
              <span className={`px-2 py-1 rounded text-xs ${fieldValue ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]'}`}>
                {fieldValue ? 'Yes' : 'No'}
              </span>
            ) : Array.isArray(fieldValue) ? (
              fieldValue.length > 0 ? fieldValue.join(', ') : 'None'
            ) : (
              fieldValue || 'Not set'
            )}
          </div>
        </div>
      );
    }

    const commonClasses = "w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg text-sm bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500";

    return (
      <div className="mb-3">
        <label className="block text-xs font-medium text-[var(--ff-text-primary)] mb-1">
          {label}
        </label>
        {type === 'textarea' || multiline ? (
          <textarea
            value={fieldValue || ''}
            onChange={(e) => updateEditValue(path, e.target.value)}
            rows={3}
            className={commonClasses}
          />
        ) : type === 'select' ? (
          <select
            value={fieldValue || ''}
            onChange={(e) => updateEditValue(path, e.target.value)}
            className={commonClasses}
          >
            <option value="">Select...</option>
            {options?.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : type === 'checkbox' ? (
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={fieldValue || false}
              onChange={(e) => updateEditValue(path, e.target.checked)}
              className="mr-2"
            />
            <span className="text-sm">Enabled</span>
          </label>
        ) : (
          <input
            type={type}
            value={fieldValue || ''}
            onChange={(e) => updateEditValue(path, type === 'number' ? Number(e.target.value) : e.target.value)}
            className={commonClasses}
          />
        )}
      </div>
    );
  };

  // Render phase properties
  const PhaseProperties = ({ data }: { data: WorkflowPhase }) => (
    <div className="space-y-4">
      {expandedSections.has('basic') && (
        <div className="border-b border-[var(--ff-border-light)] pb-4">
          <FormField label="Name" value={data.name} path="name" />
          <FormField label="Description" value={data.description} path="description" multiline />
          <FormField
            label="Color"
            value={data.color}
            path="color"
            type="text"
          />
          <FormField label="Icon" value={data.icon} path="icon" />
        </div>
      )}

      {expandedSections.has('timing') && (
        <div className="border-b border-[var(--ff-border-light)] pb-4">
          <FormField 
            label="Estimated Duration (days)" 
            value={data.estimatedDuration} 
            path="estimatedDuration" 
            type="number" 
          />
          <FormField label="Is Optional" value={data.isOptional} path="isOptional" type="checkbox" />
          <FormField label="Can Run in Parallel" value={data.isParallel} path="isParallel" type="checkbox" />
        </div>
      )}

      {expandedSections.has('assignments') && (
        <div className="border-b border-[var(--ff-border-light)] pb-4">
          <div className="mb-3">
            <label className="block text-xs font-medium text-[var(--ff-text-primary)] mb-1">
              Required Roles
            </label>
            <div className="text-sm text-[var(--ff-text-primary)]">
              {data.requiredRoles && data.requiredRoles.length > 0
                ? data.requiredRoles.join(', ')
                : 'None specified'}
            </div>
          </div>

          <div className="mb-3">
            <label className="block text-xs font-medium text-[var(--ff-text-primary)] mb-1">
              Completion Criteria
            </label>
            <div className="text-sm text-[var(--ff-text-primary)]">
              {data.completionCriteria && data.completionCriteria.length > 0
                ? data.completionCriteria.join(', ')
                : 'None specified'}
            </div>
          </div>
        </div>
      )}

      {expandedSections.has('metadata') && (
        <div>
          <FormField label="Order Index" value={data.orderIndex} path="orderIndex" type="number" readonly />
          <div className="text-xs text-[var(--ff-text-tertiary)]">
            Created: {new Date(data.createdAt).toISOString().split('T')[0]}
            <br />
            Updated: {new Date(data.updatedAt).toISOString().split('T')[0]}
          </div>
        </div>
      )}
    </div>
  );

  // Render step properties
  const StepProperties = ({ data }: { data: WorkflowStep }) => (
    <div className="space-y-4">
      {expandedSections.has('basic') && (
        <div className="border-b border-[var(--ff-border-light)] pb-4">
          <FormField label="Name" value={data.name} path="name" />
          <FormField label="Description" value={data.description} path="description" multiline />
          <FormField 
            label="Step Type" 
            value={data.stepType} 
            path="stepType" 
            type="select"
            options={[
              { value: 'task', label: 'Task' },
              { value: 'approval', label: 'Approval' },
              { value: 'review', label: 'Review' },
              { value: 'milestone', label: 'Milestone' }
            ]}
          />
          <FormField label="Instructions" value={data.instructions} path="instructions" multiline />
        </div>
      )}

      {expandedSections.has('timing') && (
        <div className="border-b border-[var(--ff-border-light)] pb-4">
          <FormField
            label="Estimated Duration (hours)"
            value={data.estimatedDuration}
            path="estimatedDuration"
            type="number"
          />
          <FormField label="Is Required" value={data.isRequired} path="isRequired" type="checkbox" />
          <FormField label="Is Automated" value={data.isAutomated} path="isAutomated" type="checkbox" />
        </div>
      )}

      {expandedSections.has('assignments') && (
        <div className="border-b border-[var(--ff-border-light)] pb-4">
          <FormField label="Assignee Role" value={data.assigneeRole} path="assigneeRole" />

          <div className="mb-3">
            <label className="block text-xs font-medium text-[var(--ff-text-primary)] mb-1">
              Resources
            </label>
            <div className="text-sm text-[var(--ff-text-primary)]">
              {data.resources && data.resources.length > 0
                ? data.resources.join(', ')
                : 'None specified'}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Render task properties
  const TaskProperties = ({ data }: { data: WorkflowTask }) => (
    <div className="space-y-4">
      {expandedSections.has('basic') && (
        <div className="border-b border-[var(--ff-border-light)] pb-4">
          <FormField label="Name" value={data.name} path="name" />
          <FormField label="Description" value={data.description} path="description" multiline />
          <FormField 
            label="Priority" 
            value={data.priority} 
            path="priority" 
            type="select"
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'critical', label: 'Critical' }
            ]}
          />
        </div>
      )}

      {expandedSections.has('timing') && (
        <div className="border-b border-[var(--ff-border-light)] pb-4">
          <FormField
            label="Estimated Hours"
            value={data.estimatedHours}
            path="estimatedHours"
            type="number"
          />
          <FormField label="Is Optional" value={data.isOptional} path="isOptional" type="checkbox" />
          <FormField label="Can Be Parallel" value={data.canBeParallel} path="canBeParallel" type="checkbox" />
        </div>
      )}

      {expandedSections.has('assignments') && (
        <div className="border-b border-[var(--ff-border-light)] pb-4">
          <div className="mb-3">
            <label className="block text-xs font-medium text-[var(--ff-text-primary)] mb-1">
              Skills Required
            </label>
            <div className="text-sm text-[var(--ff-text-primary)]">
              {data.skillsRequired && data.skillsRequired.length > 0
                ? data.skillsRequired.join(', ')
                : 'None specified'}
            </div>
          </div>

          <div className="mb-3">
            <label className="block text-xs font-medium text-[var(--ff-text-primary)] mb-1">
              Tools
            </label>
            <div className="text-sm text-[var(--ff-text-primary)]">
              {data.tools && data.tools.length > 0
                ? data.tools.join(', ')
                : 'None specified'}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (!selectedNode) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <Settings className="w-12 h-12 text-[var(--ff-text-tertiary)] mb-4" />
        <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">
          No Selection
        </h3>
        <p className="text-[var(--ff-text-secondary)] max-w-xs">
          Select a workflow component to view and edit its properties.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--ff-bg-secondary)]">
      {/* Header */}
      <div className="p-4 border-b border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Settings className="w-5 h-5 text-[var(--ff-text-secondary)]" />
            <h2 className="font-semibold text-[var(--ff-text-primary)]">Properties</h2>
          </div>
          
          <div className="flex items-center space-x-1">
            <button
              onClick={handleCopy}
              className="p-1.5 rounded hover:bg-[var(--ff-bg-hover)] transition-colors"
              title="Copy"
            >
              <Copy className="w-4 h-4 text-[var(--ff-text-secondary)]" />
            </button>

            <button
              onClick={handleDelete}
              className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              title="Delete"
            >
              <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
            </button>
          </div>
        </div>

        {/* Selected Node Info */}
        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-3">
          <div className="flex items-center space-x-2 mb-2">
            <span className={`px-2 py-1 text-xs rounded-full capitalize font-medium ${
              selectedNode.type === 'phase' 
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                : selectedNode.type === 'step'
                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                : 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
            }`}>
              {selectedNode.type}
            </span>
          </div>
          
          <h3 className="font-medium text-[var(--ff-text-primary)] truncate">
            {(selectedNode.data as any).name || 'Unnamed'}
          </h3>

          <p className="text-sm text-[var(--ff-text-secondary)] mt-1 line-clamp-2">
            {(selectedNode.data as any).description || 'No description'}
          </p>
        </div>

        {/* Edit Controls */}
        <div className="flex items-center space-x-2 mt-3">
          {isEditing ? (
            <>
              <button
                onClick={saveChanges}
                className="flex items-center space-x-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Save className="w-4 h-4" />
                <span>Save</span>
              </button>

              <button
                onClick={cancelEditing}
                className="flex items-center space-x-1 px-3 py-1.5 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] text-sm rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
              >
                <X className="w-4 h-4" />
                <span>Cancel</span>
              </button>
            </>
          ) : (
            <button
              onClick={startEditing}
              className="flex items-center space-x-1 px-3 py-1.5 bg-blue-50 text-blue-600 text-sm rounded-lg hover:bg-blue-100 transition-colors dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/30"
            >
              <Edit3 className="w-4 h-4" />
              <span>Edit</span>
            </button>
          )}
        </div>
      </div>

      {/* Properties Sections */}
      <div className="flex-1 overflow-y-auto">
        {/* Basic Properties */}
        <SectionHeader section="basic" title="Basic Properties" icon={FileText} />
        
        {/* Timing Properties */}
        <SectionHeader section="timing" title="Timing & Execution" icon={Clock} />
        
        {/* Assignment Properties */}
        <SectionHeader section="assignments" title="Assignments & Resources" icon={Users} />
        
        {/* Metadata */}
        <SectionHeader section="metadata" title="Metadata" icon={Tag} />

        {/* Property Content */}
        <div className="p-4">
          {selectedNode.type === 'phase' && <PhaseProperties data={selectedNode.data as WorkflowPhase} />}
          {selectedNode.type === 'step' && <StepProperties data={selectedNode.data as WorkflowStep} />}
          {selectedNode.type === 'task' && <TaskProperties data={selectedNode.data as WorkflowTask} />}
        </div>
      </div>
    </div>
  );
}

export default PropertiesPanel;