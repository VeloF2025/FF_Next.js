import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  Users,
  CheckCircle,
  BarChart3,
  Ticket,
  Car,
  UserCircle,
  HardHat,
  MessageSquare,
  GripVertical,
  RotateCcw,
  Save,
  Loader2,
  X
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface CustomizableItem {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

// All items that can be added to the main section
const AVAILABLE_ITEMS: CustomizableItem[] = [
  { id: 'meetings', label: 'Meetings', icon: Users, description: 'Team meetings and calendar' },
  { id: 'action-items', label: 'Action Items', icon: CheckCircle, description: 'Tasks and to-dos' },
  { id: 'tasks', label: 'Task Management', icon: CheckCircle, description: 'Project task tracking' },
  { id: 'projects', label: 'Projects', icon: LayoutDashboard, description: 'Project management' },
  { id: 'ticketing', label: 'Ticketing', icon: Ticket, description: 'Support tickets' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, description: 'Reports and dashboards' },
  { id: 'fleet', label: 'Fleet Dashboard', icon: Car, description: 'Vehicle management' },
  { id: 'staff', label: 'Staff', icon: UserCircle, description: 'Employee directory' },
  { id: 'contractors', label: 'Contractors', icon: HardHat, description: 'Contractor portal' },
  { id: 'wa-monitor', label: 'WA Monitor', icon: MessageSquare, description: 'WhatsApp monitoring' },
  { id: 'daily-progress', label: 'Daily Progress', icon: BarChart3, description: 'Daily status updates' },
];

const DEFAULT_ITEMS = ['meetings', 'action-items'];
const MAX_ITEMS = 4;

export function SidebarCustomization() {
  const [selectedItems, setSelectedItems] = useState<string[]>(DEFAULT_ITEMS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalItems, setOriginalItems] = useState<string[]>(DEFAULT_ITEMS);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);

  useEffect(() => {
    fetchPreferences();
  }, []);

  useEffect(() => {
    // Check if there are unsaved changes
    const changed = JSON.stringify(selectedItems) !== JSON.stringify(originalItems);
    setHasChanges(changed);
  }, [selectedItems, originalItems]);

  const fetchPreferences = async () => {
    try {
      const res = await fetch('/api/user-sidebar-preferences');
      const data = await res.json();
      if (data.success) {
        const items = data.data.main_section_items || DEFAULT_ITEMS;
        setSelectedItems(items);
        setOriginalItems(items);
      }
    } catch (error) {
      console.error('Failed to fetch sidebar preferences:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/user-sidebar-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ main_section_items: selectedItems })
      });
      const data = await res.json();
      if (data.success) {
        setOriginalItems(selectedItems);
        setHasChanges(false);
      }
    } catch (error) {
      console.error('Failed to save sidebar preferences:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('Reset sidebar to default items?')) return;
    setSaving(true);
    try {
      const res = await fetch('/api/user-sidebar-preferences', {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        setSelectedItems(DEFAULT_ITEMS);
        setOriginalItems(DEFAULT_ITEMS);
        setHasChanges(false);
      }
    } catch (error) {
      console.error('Failed to reset sidebar preferences:', error);
    } finally {
      setSaving(false);
    }
  };

  const toggleItem = (itemId: string) => {
    if (selectedItems.includes(itemId)) {
      // Remove item
      setSelectedItems(selectedItems.filter(id => id !== itemId));
    } else if (selectedItems.length < MAX_ITEMS) {
      // Add item
      setSelectedItems([...selectedItems, itemId]);
    }
  };

  const removeItem = (itemId: string) => {
    setSelectedItems(selectedItems.filter(id => id !== itemId));
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDraggedItem(itemId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === targetId) return;

    const dragIndex = selectedItems.indexOf(draggedItem);
    const targetIndex = selectedItems.indexOf(targetId);

    if (dragIndex === -1 || targetIndex === -1) return;

    const newItems = [...selectedItems];
    newItems.splice(dragIndex, 1);
    newItems.splice(targetIndex, 0, draggedItem);
    setSelectedItems(newItems);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
  };

  const getItemById = useCallback((id: string) => {
    return AVAILABLE_ITEMS.find(item => item.id === id);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-2">Customize Main Menu</h3>
        <p className="text-sm text-[var(--ff-text-secondary)]">
          Choose which items appear in your MAIN sidebar section. Dashboard is always visible.
          You can select up to {MAX_ITEMS} additional items.
        </p>
      </div>

      {/* Dashboard (always pinned) */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
        <div className="flex items-center space-x-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <LayoutDashboard className="w-5 h-5 text-blue-500" />
          <div className="flex-1">
            <span className="font-medium">Dashboard</span>
            <span className="ml-2 text-xs text-blue-500 bg-blue-500/20 px-2 py-0.5 rounded-full">
              Always visible
            </span>
          </div>
        </div>
      </div>

      {/* Selected Items (Draggable) */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
        <h4 className="text-sm font-semibold uppercase tracking-wider text-[var(--ff-text-tertiary)] mb-4">
          Your Shortcuts ({selectedItems.length}/{MAX_ITEMS})
        </h4>

        {selectedItems.length === 0 ? (
          <div className="text-center py-8 text-[var(--ff-text-tertiary)] border-2 border-dashed border-[var(--ff-border-light)] rounded-lg">
            No items selected. Choose from the available items below.
          </div>
        ) : (
          <div className="space-y-2">
            {selectedItems.map((itemId) => {
              const item = getItemById(itemId);
              if (!item) return null;
              const Icon = item.icon;

              return (
                <div
                  key={itemId}
                  draggable
                  onDragStart={(e) => handleDragStart(e, itemId)}
                  onDragOver={(e) => handleDragOver(e, itemId)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center space-x-3 p-3 border rounded-lg cursor-move transition-all
                    ${draggedItem === itemId
                      ? 'border-blue-500 bg-blue-500/10 opacity-50'
                      : 'border-[var(--ff-border-light)] hover:border-blue-500/50 hover:bg-[var(--ff-bg-hover)]'
                    }`}
                >
                  <GripVertical className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                  <Icon className="w-5 h-5 text-[var(--ff-text-secondary)]" />
                  <span className="flex-1 font-medium">{item.label}</span>
                  <button
                    onClick={() => removeItem(itemId)}
                    className="p-1 text-[var(--ff-text-tertiary)] hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                    title="Remove"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-[var(--ff-text-tertiary)] mt-3">
          Drag to reorder items
        </p>
      </div>

      {/* Available Items */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
        <h4 className="text-sm font-semibold uppercase tracking-wider text-[var(--ff-text-tertiary)] mb-4">
          Available Items
        </h4>

        <div className="grid grid-cols-2 gap-3">
          {AVAILABLE_ITEMS.map((item) => {
            const isSelected = selectedItems.includes(item.id);
            const isDisabled = !isSelected && selectedItems.length >= MAX_ITEMS;
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                onClick={() => !isDisabled && toggleItem(item.id)}
                disabled={isDisabled}
                className={`flex items-start space-x-3 p-3 border rounded-lg text-left transition-all
                  ${isSelected
                    ? 'border-blue-500 bg-blue-500/10'
                    : isDisabled
                      ? 'border-[var(--ff-border-light)] opacity-50 cursor-not-allowed'
                      : 'border-[var(--ff-border-light)] hover:border-blue-500/50 hover:bg-[var(--ff-bg-hover)] cursor-pointer'
                  }`}
              >
                <div className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center
                  ${isSelected ? 'bg-blue-500 border-blue-500' : 'border-[var(--ff-border-light)]'}`}
                >
                  {isSelected && <CheckCircle className="w-3 h-3 text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <Icon className={`w-4 h-4 ${isSelected ? 'text-blue-500' : 'text-[var(--ff-text-secondary)]'}`} />
                    <span className={`font-medium text-sm ${isSelected ? 'text-blue-500' : ''}`}>
                      {item.label}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-1 truncate">
                    {item.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between bg-[var(--ff-bg-secondary)] rounded-lg shadow p-4">
        <button
          onClick={handleReset}
          disabled={saving}
          className="flex items-center space-x-2 px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] rounded-lg transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Reset to Defaults</span>
        </button>

        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className={`flex items-center space-x-2 px-6 py-2 rounded-lg font-medium transition-colors
            ${hasChanges
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
            }`}
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          <span>{saving ? 'Saving...' : hasChanges ? 'Save Changes' : 'Saved'}</span>
        </button>
      </div>
    </div>
  );
}
