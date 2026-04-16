// 🟢 WORKING: Main Workflow Editor component with canvas layout
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Save,
  ZoomIn,
  ZoomOut,
  Grid3x3,
  AlertTriangle,
  Check,
  Eye,
  EyeOff
} from 'lucide-react';
import { useWorkflowEditor } from '../../context/WorkflowEditorContext';
import { EditorCanvas } from './EditorCanvas';
import { ComponentPalette } from './ComponentPalette';
import { PropertiesPanel } from './PropertiesPanel';
import { EditorToolbar } from './EditorToolbar';
import { WorkflowEditorForms } from './forms';
import { ValidationPanel } from './ValidationPanel';
import { EditorMinimap } from './EditorMinimap';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';

interface WorkflowEditorProps {
  templateId?: string;
  className?: string;
}

export function WorkflowEditor({ templateId, className = '' }: WorkflowEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  
  const {
    state,
    loadTemplate,
    saveTemplate,
    createNewTemplate,
    updateSettings,
    setActivePanel,
    toggleMinimap,
    clearSelection
  } = useWorkflowEditor();

  // Initialize editor
  useEffect(() => {
    setMounted(true);
    
    if (templateId) {
      loadTemplate(templateId);
    } else {
      createNewTemplate();
    }
  }, [templateId, loadTemplate, createNewTemplate]);

  // Auto-save functionality
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (state.hasUnsavedChanges) {
        event.preventDefault();
        event.returnValue = '';
        return '';
      }
      return undefined;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state.hasUnsavedChanges]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const { ctrlKey, metaKey, key } = event;
      const cmdOrCtrl = ctrlKey || metaKey;

      if (cmdOrCtrl) {
        switch (key) {
          case 's':
            event.preventDefault();
            if (state.hasUnsavedChanges) {
              saveTemplate();
            }
            break;
          case 'z':
            event.preventDefault();
            // TODO: Implement undo
            break;
          case 'y':
            event.preventDefault();
            // TODO: Implement redo
            break;
          case 'a':
            event.preventDefault();
            // TODO: Select all nodes
            break;
          case 'Escape':
            clearSelection();
            break;
        }
      }
      
      if (key === 'Delete' && state.selectedNodes.length > 0) {
        // TODO: Delete selected nodes
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.hasUnsavedChanges, state.selectedNodes, saveTemplate, clearSelection]);

  // Handle canvas click to clear selection
  const handleCanvasClick = useCallback((event: React.MouseEvent) => {
    // Only clear if clicking on canvas background, not nodes
    if (event.target === event.currentTarget) {
      clearSelection();
    }
  }, [clearSelection]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    const newZoom = Math.min(state.settings.zoomLevel * 1.2, 3);
    updateSettings({ zoomLevel: newZoom });
  }, [state.settings.zoomLevel, updateSettings]);

  const handleZoomOut = useCallback(() => {
    const newZoom = Math.max(state.settings.zoomLevel * 0.8, 0.3);
    updateSettings({ zoomLevel: newZoom });
  }, [state.settings.zoomLevel, updateSettings]);

  const handleZoomReset = useCallback(() => {
    updateSettings({ zoomLevel: 1 });
  }, [updateSettings]);

  // Toggle grid
  const toggleGrid = useCallback(() => {
    updateSettings({ showGrid: !state.settings.showGrid });
  }, [state.settings.showGrid, updateSettings]);

  if (!mounted) {
    return (
      <div className="h-screen flex items-center justify-center">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  return (
    <div
      ref={editorRef}
      className={`workflow-editor h-screen flex flex-col bg-[var(--ff-bg-tertiary)] ${className}`}
    >
      {/* Editor Header */}
      <div className="flex-none border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
              {state.currentTemplate?.name || 'New Workflow Template'}
            </h1>
            
            {state.hasUnsavedChanges && (
              <div className="flex items-center space-x-1 text-amber-600 dark:text-amber-400">
                <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                <span className="text-sm">Unsaved changes</span>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {/* Validation Status */}
            {state.validationResult && (
              <button
                onClick={() => setActivePanel(state.activePanel === 'validation' ? null : 'validation')}
                className={`p-2 rounded-lg border transition-colors ${
                  state.validationResult.isValid
                    ? 'border-green-500/30 bg-green-500/20 text-green-400 hover:bg-green-500/30'
                    : 'border-red-500/30 bg-red-500/20 text-red-400 hover:bg-red-500/30'
                }`}
                title={`${state.validationResult.errors.length} errors, ${state.validationResult.warnings.length} warnings`}
              >
                {state.validationResult.isValid ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <AlertTriangle className="w-4 h-4" />
                )}
              </button>
            )}

            {/* Zoom Controls */}
            <div role="toolbar" aria-label="Editor controls" className="flex items-center space-x-1 bg-[var(--ff-bg-tertiary)] rounded-lg p-1">
              <button
                onClick={handleZoomOut}
                className="p-1.5 hover:bg-[var(--ff-bg-secondary)] rounded transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>

              <button
                onClick={handleZoomReset}
                className="px-3 py-1.5 hover:bg-[var(--ff-bg-secondary)] rounded transition-colors text-sm font-medium"
                title="Reset Zoom"
              >
                {Math.round(state.settings.zoomLevel * 100)}%
              </button>

              <button
                onClick={handleZoomIn}
                className="p-1.5 hover:bg-[var(--ff-bg-secondary)] rounded transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            {/* Grid Toggle */}
            <button
              onClick={toggleGrid}
              className={`p-2 rounded-lg border transition-colors ${
                state.settings.showGrid
                  ? 'border-blue-500/30 bg-blue-500/20 text-blue-400'
                  : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
              }`}
              title="Toggle Grid"
            >
              <Grid3x3 className="w-4 h-4" />
            </button>

            {/* Minimap Toggle */}
            <button
              onClick={toggleMinimap}
              className={`p-2 rounded-lg border transition-colors ${
                state.showMinimap
                  ? 'border-blue-500/30 bg-blue-500/20 text-blue-400'
                  : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
              }`}
              title="Toggle Minimap"
            >
              {state.showMinimap ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>

            {/* Save Button */}
            <button
              onClick={saveTemplate}
              disabled={!state.hasUnsavedChanges || state.isLoading}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                state.hasUnsavedChanges
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
              }`}
              title="Save Template"
            >
              <div className="flex items-center space-x-2">
                <Save className="w-4 h-4" />
                <span>Save</span>
              </div>
            </button>
          </div>
        </div>

        {/* Editor Toolbar */}
        <EditorToolbar />
      </div>

      {/* Main Editor Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Component Palette */}
        <div className={`flex-none transition-all duration-300 ${
          state.activePanel === 'palette' ? 'w-64' : 'w-0'
        } overflow-hidden border-r border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]`}>
          {state.activePanel === 'palette' && <ComponentPalette />}
        </div>

        {/* Main Canvas Area */}
        <div className="flex-1 relative">
          {/* Loading Overlay */}
          {state.isLoading && (
            <div className="absolute inset-0 bg-[var(--ff-bg-secondary)]/50 backdrop-blur-sm z-50 flex items-center justify-center">
              <div className="flex items-center space-x-3">
                <InlineSpinner size="sm" />
                <span className="text-sm font-medium text-[var(--ff-text-secondary)]">
                  {templateId ? 'Loading template...' : 'Saving...'}
                </span>
              </div>
            </div>
          )}

          {/* Error State */}
          {state.error && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-40">
              <div role="alert" aria-live="polite" className="bg-red-500/20 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg shadow-lg">
                <div className="flex items-center space-x-2">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="font-medium">Error:</span>
                  <span>{state.error}</span>
                </div>
              </div>
            </div>
          )}

          {/* Status announcements for screen readers */}
          <div role="status" aria-live="polite" className="sr-only">
            {state.isLoading ? 'Loading template...' : state.hasUnsavedChanges ? 'Template has unsaved changes' : 'Template saved'}
          </div>

          {/* Canvas */}
          <div
            className="h-full w-full overflow-hidden"
            onClick={handleCanvasClick}
          >
            <EditorCanvas />
          </div>

          {/* Minimap */}
          {state.showMinimap && (
            <div className="absolute bottom-4 right-4 z-30">
              <EditorMinimap />
            </div>
          )}
        </div>

        {/* Right Sidebar - Properties & Validation */}
        <div className={`flex-none transition-all duration-300 ${
          state.activePanel === 'properties' || state.activePanel === 'validation' ? 'w-80' : 'w-0'
        } overflow-hidden border-l border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]`}>
          {state.activePanel === 'properties' && <PropertiesPanel />}
          {state.activePanel === 'validation' && <ValidationPanel />}
        </div>
      </div>

      {/* Editor Forms Modal */}
      <WorkflowEditorForms />
    </div>
  );
}

// 🟢 WORKING: Workflow editor with dark mode support using CSS variables

export default WorkflowEditor;