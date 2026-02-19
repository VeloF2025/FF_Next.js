// ============= Messages Tab =============
// Supplier messaging with threading, filtering, and real-time communication

import { useState, useMemo } from 'react';
import { MessageSquare, Send, Search } from 'lucide-react';
import { useSuppliersPortal } from '../../context/SuppliersPortalContext';
import { useMessageFilters } from './messages-tab/hooks/useMessageFilters';
import { messagesToThreads } from './messages-tab/utils/messageHelpers';
import type { Message, MessageThread } from './messages-tab/types/messages.types';
import {
  MessageThreadItem,
  MessageDetailView,
  MessageFilters,
  NoSupplierState,
  NoMessagesState
} from './messages-tab/components';

export function MessagesTab() {
  const { selectedSupplier } = useSuppliersPortal();
  const [selectedThread, setSelectedThread] = useState<MessageThread | null>(null);

  // Convert messages to threads
  const messageThreads = useMemo(() => messagesToThreads([] as Message[]), []);

  // Filter management
  const {
    searchTerm,
    setSearchTerm,
    categoryFilter,
    setCategoryFilter,
    priorityFilter,
    setPriorityFilter,
    statusFilter,
    setStatusFilter,
    filteredThreads
  } = useMessageFilters({ threads: messageThreads, selectedSupplier });

  // Show empty state if no supplier selected
  if (!selectedSupplier) {
    return <NoSupplierState />;
  }

  return (
    <div className="h-[800px] bg-card border border-border rounded-lg overflow-hidden">
      <div className="flex h-full">
        {/* Messages List - Left Panel */}
        <div className="w-96 border-r border-border flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">Messages</h2>
              <button className="px-3 py-1 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700">
                <Send className="w-4 h-4 inline mr-1" />
                New
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search messages..."
                className="w-full pl-10 pr-4 py-2 border border-border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {/* Filters */}
          <MessageFilters
            categoryFilter={categoryFilter}
            onCategoryChange={setCategoryFilter}
            priorityFilter={priorityFilter}
            onPriorityChange={setPriorityFilter}
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
          />

          {/* Message Threads */}
          <div className="flex-1 overflow-y-auto">
            {filteredThreads.length === 0 ? (
              <NoMessagesState />
            ) : (
              filteredThreads.map((thread) => (
                <MessageThreadItem
                  key={thread.id}
                  thread={thread}
                  isSelected={selectedThread?.id === thread.id}
                  onClick={() => setSelectedThread(thread)}
                />
              ))
            )}
          </div>
        </div>

        {/* Message Detail - Right Panel */}
        <MessageDetailView thread={selectedThread} />
      </div>
    </div>
  );
}
