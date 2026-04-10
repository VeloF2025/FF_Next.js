// 🟢 WORKING: Component palette for dragging new workflow items
import React, { useState, useCallback } from 'react';
import { 
  PlayCircle, 
  Settings, 
  FileText, 
  Search, 
  ChevronDown,
  Layers,
  Workflow
} from 'lucide-react';
import { useWorkflowEditor } from '../../context/WorkflowEditorContext';

interface PaletteItem {
  id: string;
  type: 'phase' | 'step' | 'task';
  name: string;
  description: string;
  icon: React.ElementType;
  category: string;
  color: string;
  template?: any; // Pre-filled data for the item
}

// Predefined palette items
const PALETTE_ITEMS: PaletteItem[] = [
  // Phases
  {
    id: 'phase-planning',
    type: 'phase',
    name: 'Planning Phase',
    description: 'Initial project planning and requirement gathering',
    icon: PlayCircle,
    category: 'Common',
    color: 'bg-blue-500',
    template: {
      name: 'Planning Phase',
      description: 'Initial project planning and requirement gathering',
      estimatedDuration: 5,
      requiredRoles: ['Project Manager', 'Business Analyst'],
      isOptional: false,
      isParallel: false
    }
  },
  {
    id: 'phase-design',
    type: 'phase',
    name: 'Design Phase',
    description: 'System design and architecture planning',
    icon: PlayCircle,
    category: 'Common',
    color: 'bg-blue-500',
    template: {
      name: 'Design Phase',
      description: 'System design and architecture planning',
      estimatedDuration: 10,
      requiredRoles: ['System Architect', 'UI/UX Designer'],
      isOptional: false,
      isParallel: false
    }
  },
  {
    id: 'phase-implementation',
    type: 'phase',
    name: 'Implementation',
    description: 'Development and implementation phase',
    icon: PlayCircle,
    category: 'Common',
    color: 'bg-blue-500',
    template: {
      name: 'Implementation Phase',
      description: 'Development and implementation phase',
      estimatedDuration: 20,
      requiredRoles: ['Developer', 'Technical Lead'],
      isOptional: false,
      isParallel: false
    }
  },
  
  // Steps
  {
    id: 'step-review',
    type: 'step',
    name: 'Review Step',
    description: 'Review and quality assurance step',
    icon: Settings,
    category: 'Common',
    color: 'bg-green-500',
    template: {
      name: 'Review Step',
      description: 'Review and quality assurance step',
      stepType: 'review',
      estimatedDuration: 2,
      assigneeRole: 'Reviewer',
      isRequired: true,
      isAutomated: false
    }
  },
  {
    id: 'step-approval',
    type: 'step',
    name: 'Approval Step',
    description: 'Management approval checkpoint',
    icon: Settings,
    category: 'Common',
    color: 'bg-green-500',
    template: {
      name: 'Approval Step',
      description: 'Management approval checkpoint',
      stepType: 'approval',
      estimatedDuration: 1,
      assigneeRole: 'Manager',
      isRequired: true,
      isAutomated: false
    }
  },
  {
    id: 'step-testing',
    type: 'step',
    name: 'Testing Step',
    description: 'Quality assurance and testing',
    icon: Settings,
    category: 'Technical',
    color: 'bg-green-500',
    template: {
      name: 'Testing Step',
      description: 'Quality assurance and testing',
      stepType: 'task',
      estimatedDuration: 4,
      assigneeRole: 'QA Tester',
      isRequired: true,
      isAutomated: false
    }
  },
  
  // Tasks
  {
    id: 'task-documentation',
    type: 'task',
    name: 'Documentation',
    description: 'Create or update documentation',
    icon: FileText,
    category: 'Common',
    color: 'bg-purple-500',
    template: {
      name: 'Documentation Task',
      description: 'Create or update documentation',
      priority: 'medium',
      estimatedHours: 4,
      skillsRequired: ['Technical Writing'],
      isOptional: false,
      canBeParallel: true
    }
  },
  {
    id: 'task-coding',
    type: 'task',
    name: 'Development',
    description: 'Code development and implementation',
    icon: FileText,
    category: 'Technical',
    color: 'bg-purple-500',
    template: {
      name: 'Development Task',
      description: 'Code development and implementation',
      priority: 'high',
      estimatedHours: 8,
      skillsRequired: ['Programming', 'Software Development'],
      isOptional: false,
      canBeParallel: true
    }
  },
  {
    id: 'task-testing',
    type: 'task',
    name: 'Testing',
    description: 'Unit testing and quality assurance',
    icon: FileText,
    category: 'Technical',
    color: 'bg-purple-500',
    template: {
      name: 'Testing Task',
      description: 'Unit testing and quality assurance',
      priority: 'high',
      estimatedHours: 6,
      skillsRequired: ['Testing', 'Quality Assurance'],
      isOptional: false,
      canBeParallel: false
    }
  }
];

const CATEGORIES = ['All', 'Common', 'Technical', 'Custom'];

export function ComponentPalette() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['Common']));
  
  const { startEditingItem } = useWorkflowEditor();

  // Filter items based on search and category
  const filteredItems = PALETTE_ITEMS.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  // Group items by category
  const itemsByCategory = filteredItems.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category]!.push(item);
    return acc;
  }, {} as Record<string, PaletteItem[]>);

  // Handle drag start
  const handleDragStart = useCallback((event: React.DragEvent, item: PaletteItem) => {
    const dragData = {
      type: item.type,
      template: item.template,
      source: 'palette'
    };
    
    event.dataTransfer.setData('application/json', JSON.stringify(dragData));
    event.dataTransfer.effectAllowed = 'copy';
    
    // Set drag image
    const dragImage = event.currentTarget.cloneNode(true) as HTMLElement;
    dragImage.style.transform = 'scale(0.8)';
    dragImage.style.opacity = '0.8';
    document.body.appendChild(dragImage);
    event.dataTransfer.setDragImage(dragImage, 0, 0);
    
    // Clean up drag image
    setTimeout(() => {
      document.body.removeChild(dragImage);
    }, 0);
  }, []);

  // Handle double-click to add item
  const handleDoubleClick = useCallback((item: PaletteItem) => {
    // Add item at center of viewport
    startEditingItem(item.type, undefined, undefined);
  }, [startEditingItem]);

  // Toggle category expansion
  const toggleCategory = useCallback((category: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  }, []);

  return (
    <div className="h-full flex flex-col bg-[var(--ff-bg-secondary)]">
      {/* Header */}
      <div className="p-4 border-b border-[var(--ff-border-light)]">
        <div className="flex items-center space-x-2 mb-3">
          <Layers className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h2 className="font-semibold text-[var(--ff-text-primary)]">Components</h2>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search components..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-[var(--ff-border-light)] rounded-lg text-sm bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map(category => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                selectedCategory === category
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                  : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      {/* Component List */}
      <div className="flex-1 overflow-y-auto">
        {Object.entries(itemsByCategory).map(([category, items]) => (
          <div key={category} className="mb-2">
            {/* Category Header */}
            <button
              onClick={() => toggleCategory(category)}
              className="w-full px-4 py-2 flex items-center justify-between text-sm font-medium text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] transition-colors"
            >
              <span>{category}</span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${
                  expandedCategories.has(category) ? 'transform rotate-180' : ''
                }`}
              />
            </button>

            {/* Category Items */}
            {expandedCategories.has(category) && (
              <div className="pb-2">
                {items.map(item => {
                  const Icon = item.icon;
                  
                  return (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, item)}
                      onDoubleClick={() => handleDoubleClick(item)}
                      className="mx-2 mb-2 p-3 border border-[var(--ff-border-light)] rounded-lg cursor-grab active:cursor-grabbing hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition-all bg-[var(--ff-bg-secondary)]"
                      title="Drag to canvas or double-click to add"
                    >
                      <div className="flex items-center space-x-2 mb-2">
                        <div className={`p-1.5 rounded ${item.color} text-white`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                            {item.name}
                          </h3>
                        </div>
                      </div>

                      <p className="text-xs text-[var(--ff-text-secondary)] line-clamp-2">
                        {item.description}
                      </p>
                      
                      {/* Item Type Badge */}
                      <div className="mt-2 flex justify-between items-center">
                        <span className={`px-2 py-0.5 text-xs rounded-full capitalize ${
                          item.type === 'phase' 
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                            : item.type === 'step'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                            : 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
                        }`}>
                          {item.type}
                        </span>
                        
                        {/* Quick stats */}
                        {item.template && (
                          <div className="text-xs text-[var(--ff-text-tertiary)]">
                            {item.type === 'phase' && item.template.estimatedDuration && (
                              <span>{item.template.estimatedDuration}d</span>
                            )}
                            {item.type === 'step' && item.template.estimatedDuration && (
                              <span>{item.template.estimatedDuration}h</span>
                            )}
                            {item.type === 'task' && item.template.estimatedHours && (
                              <span>{item.template.estimatedHours}h</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {/* Empty State */}
        {filteredItems.length === 0 && (
          <div className="p-4 text-center text-[var(--ff-text-tertiary)]">
            <Workflow className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No components found</p>
            {searchTerm && (
              <p className="text-xs mt-1">Try adjusting your search terms</p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-[var(--ff-border-light)]">
        <div className="text-xs text-[var(--ff-text-tertiary)] space-y-1">
          <div>• Drag items to canvas</div>
          <div>• Double-click to add</div>
          <div>• {filteredItems.length} components available</div>
        </div>
      </div>
    </div>
  );
}

export default ComponentPalette;