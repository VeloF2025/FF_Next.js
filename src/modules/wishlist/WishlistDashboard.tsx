/**
 * Wishlist Dashboard - Main Kanban board view
 */

import { useState, useEffect } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { Plus, RefreshCw, BarChart3, Settings } from 'lucide-react';
import { useWishlist } from './hooks/useWishlist';
import { WishlistKanban } from './components/WishlistKanban';
import { WishlistAnalytics } from './components/WishlistAnalytics';
import { AddWishlistItemModal } from './components/AddWishlistItemModal';
import { AttachmentsModal } from './components/AttachmentsModal';
import { StandardModuleHeader } from '@/components/ui/StandardModuleHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { WishlistItem } from './types/wishlist';
// AppLayout removed - handled by page wrapper

type TabType = 'board' | 'analytics' | 'settings';

export function WishlistDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('board');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [attachmentsItem, setAttachmentsItem] = useState<WishlistItem | null>(null);
  // Fix hydration: Only render DragDropContext on client after mount
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const {
    board,
    loading,
    error,
    refetch,
    createItem,
    updateItem,
    moveItem,
    voteItem,
    deleteItem,
  } = useWishlist();

  // State for editing items
  const [editItem, setEditItem] = useState<WishlistItem | null>(null);

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const { draggableId, destination } = result;
    const targetColumn = destination.droppableId;
    const position = destination.index;

    moveItem(draggableId, targetColumn, position);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleExport = () => {
    // TODO: Implement export functionality
    console.log('Export wishlist data');
  };

  if (loading && !board.columns.length) {
    return (
      <div className="flex items-center justify-center h-screen">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <button
            onClick={refetch}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
        {/* Header */}
        <StandardModuleHeader
          title="Feature Wishlist"
          description="Track and prioritize feature requests with our Kanban board"
          onExport={handleExport}
          exportDisabled={board.stats.total === 0}
          showImport={false}
          showExport={true}
          showAdd={false}
          itemCount={board.stats.total}
        />

        {/* Custom Actions */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className={`inline-flex items-center px-4 py-2 text-sm font-medium text-[var(--ff-text-primary)] bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors ${
              refreshing ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-[var(--ff-border-light)]">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('board')}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'board'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
              }`}
            >
              <span className="flex items-center gap-2">
                Kanban Board
                <span className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] text-xs rounded-full px-2 py-0.5">
                  {board.stats.total}
                </span>
              </span>
            </button>
            <button
              onClick={() => setActiveTab('analytics')}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'analytics'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
              }`}
            >
              <span className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Analytics
              </span>
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'settings'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
              }`}
            >
              <span className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Settings
              </span>
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="min-h-[600px]">
          {activeTab === 'board' && (
            // Only render DragDropContext on client to prevent hydration mismatch
            isMounted ? (
              <DragDropContext onDragEnd={handleDragEnd}>
                <WishlistKanban
                  board={board}
                  onVote={voteItem}
                  onDelete={deleteItem}
                  onEdit={setEditItem}
                  onAttachments={setAttachmentsItem}
                />
              </DragDropContext>
            ) : (
              // Server/initial render: show static version without drag-drop
              <div className="flex gap-4 overflow-x-auto pb-4">
                {board.columns.map((column) => (
                  <div key={column.id} className="min-w-[320px]">
                    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-medium">{column.name}</h3>
                        <span className="text-sm text-[var(--ff-text-tertiary)]">
                          {column.items?.length || 0}
                        </span>
                      </div>
                      <div className="space-y-3">
                        {column.items?.map((item) => (
                          <div
                            key={item.id}
                            className="bg-[var(--ff-bg-primary)] rounded-lg p-4 border border-[var(--ff-border-light)]"
                          >
                            <h4 className="font-medium text-sm">{item.title}</h4>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {activeTab === 'analytics' && board.stats && (
            <WishlistAnalytics stats={board.stats} />
          )}

          {activeTab === 'settings' && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6">
              <h3 className="text-lg font-medium mb-4">Wishlist Settings</h3>
              <p className="text-[var(--ff-text-secondary)]">
                Configure wishlist board settings and preferences.
              </p>
              {/* TODO: Add settings configuration */}
            </div>
          )}
        </div>

        {/* Add/Edit Item Modal */}
        <AddWishlistItemModal
          isOpen={isAddModalOpen || !!editItem}
          onClose={() => {
            setIsAddModalOpen(false);
            setEditItem(null);
          }}
          onSubmit={createItem}
          onUpdate={updateItem}
          editItem={editItem}
        />

        {/* Attachments Modal */}
        <AttachmentsModal
          isOpen={!!attachmentsItem}
          onClose={() => {
            setAttachmentsItem(null);
            refetch(); // Refresh to update attachment counts
          }}
          itemId={attachmentsItem?.id || ''}
          itemTitle={attachmentsItem?.title || ''}
        />
      </div>
  );
}

// Export as default for routing
export default WishlistDashboard;