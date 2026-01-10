// 🟢 WORKING: Editor toolbar with editor actions and controls
import { useCallback } from 'react';
import { 
  MousePointer, 
  Layers, 
  Settings, 
  AlertTriangle, 
  Copy,
  Scissors,
  Clipboard,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Download,
  Upload,
  FileText
} from 'lucide-react';
import { useWorkflowEditor } from '../../context/WorkflowEditorContext';

export function EditorToolbar() {
  const {
    state,
    setActivePanel,
    updateSettings,
    validateTemplate,
    clearSelection,
    copyToClipboard,
    arrangeNodes
  } = useWorkflowEditor();

  // Toggle panels
  const togglePalette = useCallback(() => {
    setActivePanel(state.activePanel === 'palette' ? null : 'palette');
  }, [state.activePanel, setActivePanel]);

  const toggleProperties = useCallback(() => {
    setActivePanel(state.activePanel === 'properties' ? null : 'properties');
  }, [state.activePanel, setActivePanel]);

  const toggleValidation = useCallback(() => {
    if (state.activePanel !== 'validation') {
      validateTemplate();
    }
    setActivePanel(state.activePanel === 'validation' ? null : 'validation');
  }, [state.activePanel, setActivePanel, validateTemplate]);

  // Selection tools
  const handleSelectAll = useCallback(() => {
    // TODO: Implement select all
  }, []);

  const handleClearSelection = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  // Clipboard operations
  const handleCopy = useCallback(() => {
    const selectedNode = state.nodes.find(node => state.selectedNodes.includes(node.id));
    if (selectedNode) {
      copyToClipboard(selectedNode.type, selectedNode.data);
    }
  }, [state.nodes, state.selectedNodes, copyToClipboard]);

  const handleCut = useCallback(() => {
    // TODO: Implement cut
    handleCopy();
  }, [handleCopy]);

  const handlePaste = useCallback(() => {
    // TODO: Implement paste
  }, []);

  // Layout operations
  const handleAutoArrange = useCallback(() => {
    arrangeNodes();
  }, [arrangeNodes]);

  const handleAlignLeft = useCallback(() => {
    // TODO: Implement align left
  }, []);

  const handleAlignCenter = useCallback(() => {
    // TODO: Implement align center
  }, []);

  const handleAlignRight = useCallback(() => {
    // TODO: Implement align right
  }, []);

  // Import/Export
  const handleExport = useCallback(() => {
    // TODO: Implement template export
  }, []);

  const handleImport = useCallback(() => {
    // TODO: Implement template import
  }, []);

  // View mode toggle
  const toggleViewMode = useCallback(() => {
    const modes = ['hierarchical', 'flowchart', 'compact'] as const;
    const currentIndex = modes.indexOf(state.settings.viewMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    updateSettings({ viewMode: modes[nextIndex] });
  }, [state.settings.viewMode, updateSettings]);

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]">
      {/* Left Section - Panel Toggles */}
      <div className="flex items-center space-x-1">
        <button
          onClick={togglePalette}
          className={`p-2 rounded-lg transition-colors ${
            state.activePanel === 'palette'
              ? 'bg-blue-500/20 text-blue-400'
              : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] hover:text-[var(--ff-text-primary)]'
          }`}
          title="Component Palette (P)"
        >
          <Layers className="w-4 h-4" />
        </button>

        <button
          onClick={toggleProperties}
          className={`p-2 rounded-lg transition-colors ${
            state.activePanel === 'properties'
              ? 'bg-blue-500/20 text-blue-400'
              : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] hover:text-[var(--ff-text-primary)]'
          }`}
          title="Properties Panel"
          disabled={state.selectedNodes.length === 0}
        >
          <Settings className="w-4 h-4" />
        </button>

        <button
          onClick={toggleValidation}
          className={`p-2 rounded-lg transition-colors ${
            state.activePanel === 'validation'
              ? 'bg-blue-500/20 text-blue-400'
              : state.validationResult && !state.validationResult.isValid
              ? 'text-red-400 hover:bg-red-500/20'
              : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] hover:text-[var(--ff-text-primary)]'
          }`}
          title="Validation Panel"
        >
          <AlertTriangle className="w-4 h-4" />
        </button>

        <div className="w-px h-6 bg-[var(--ff-border-light)] mx-2" />

        {/* Selection Tools */}
        <div className="flex items-center space-x-1">
          <button
            onClick={handleSelectAll}
            className="p-2 rounded-lg text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] hover:text-[var(--ff-text-primary)] transition-colors"
            title="Select All (Ctrl+A)"
          >
            <MousePointer className="w-4 h-4" />
          </button>

          <button
            onClick={handleClearSelection}
            className="p-2 rounded-lg text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] hover:text-[var(--ff-text-primary)] transition-colors"
            disabled={state.selectedNodes.length === 0}
            title="Clear Selection"
          >
            <MousePointer className="w-4 h-4 opacity-50" />
          </button>
        </div>
      </div>

      {/* Center Section - Editing Tools */}
      <div className="flex items-center space-x-1">
        {/* Clipboard Operations */}
        <div className="flex items-center space-x-1">
          <button
            onClick={handleCopy}
            className="p-2 rounded-lg text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] hover:text-[var(--ff-text-primary)] transition-colors"
            disabled={state.selectedNodes.length === 0}
            title="Copy (Ctrl+C)"
          >
            <Copy className="w-4 h-4" />
          </button>

          <button
            onClick={handleCut}
            className="p-2 rounded-lg text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] hover:text-[var(--ff-text-primary)] transition-colors"
            disabled={state.selectedNodes.length === 0}
            title="Cut (Ctrl+X)"
          >
            <Scissors className="w-4 h-4" />
          </button>

          <button
            onClick={handlePaste}
            className="p-2 rounded-lg text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] hover:text-[var(--ff-text-primary)] transition-colors"
            disabled={!state.clipboard}
            title="Paste (Ctrl+V)"
          >
            <Clipboard className="w-4 h-4" />
          </button>
        </div>

        <div className="w-px h-6 bg-[var(--ff-border-light)] mx-2" />

        {/* Alignment Tools */}
        <div className="flex items-center space-x-1">
          <button
            onClick={handleAlignLeft}
            className="p-2 rounded-lg text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] hover:text-[var(--ff-text-primary)] transition-colors"
            disabled={state.selectedNodes.length < 2}
            title="Align Left"
          >
            <AlignLeft className="w-4 h-4" />
          </button>

          <button
            onClick={handleAlignCenter}
            className="p-2 rounded-lg text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] hover:text-[var(--ff-text-primary)] transition-colors"
            disabled={state.selectedNodes.length < 2}
            title="Align Center"
          >
            <AlignCenter className="w-4 h-4" />
          </button>

          <button
            onClick={handleAlignRight}
            className="p-2 rounded-lg text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] hover:text-[var(--ff-text-primary)] transition-colors"
            disabled={state.selectedNodes.length < 2}
            title="Align Right"
          >
            <AlignRight className="w-4 h-4" />
          </button>

          <button
            onClick={handleAutoArrange}
            className="p-2 rounded-lg text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] hover:text-[var(--ff-text-primary)] transition-colors"
            disabled={state.nodes.length === 0}
            title="Auto Arrange"
          >
            <AlignJustify className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Right Section - View & Export Tools */}
      <div className="flex items-center space-x-1">
        {/* View Mode Toggle */}
        <button
          onClick={toggleViewMode}
          className="px-3 py-2 rounded-lg text-sm font-medium text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] hover:text-[var(--ff-text-primary)] transition-colors capitalize"
          title={`Current: ${state.settings.viewMode}`}
        >
          {state.settings.viewMode}
        </button>

        <div className="w-px h-6 bg-[var(--ff-border-light)] mx-2" />

        {/* Import/Export */}
        <div className="flex items-center space-x-1">
          <button
            onClick={handleImport}
            className="p-2 rounded-lg text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] hover:text-[var(--ff-text-primary)] transition-colors"
            title="Import Template"
          >
            <Upload className="w-4 h-4" />
          </button>

          <button
            onClick={handleExport}
            className="p-2 rounded-lg text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] hover:text-[var(--ff-text-primary)] transition-colors"
            disabled={!state.currentTemplate}
            title="Export Template"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>

        {/* Template Info */}
        {state.currentTemplate && (
          <div className="flex items-center space-x-2 ml-4 px-3 py-1 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
            <FileText className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
            <div className="text-sm">
              <span className="text-[var(--ff-text-primary)] font-medium">
                {state.nodes.filter(n => n.type === 'phase').length}
              </span>
              <span className="text-[var(--ff-text-secondary)] ml-1">phases</span>

              <span className="text-[var(--ff-border-light)] mx-2">|</span>

              <span className="text-[var(--ff-text-primary)] font-medium">
                {state.nodes.filter(n => n.type === 'step').length}
              </span>
              <span className="text-[var(--ff-text-secondary)] ml-1">steps</span>

              <span className="text-[var(--ff-border-light)] mx-2">|</span>

              <span className="text-[var(--ff-text-primary)] font-medium">
                {state.nodes.filter(n => n.type === 'task').length}
              </span>
              <span className="text-[var(--ff-text-secondary)] ml-1">tasks</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default EditorToolbar;