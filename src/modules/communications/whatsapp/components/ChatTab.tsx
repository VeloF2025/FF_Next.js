/**
 * Chat Tab - Real-time chat interface for WhatsApp groups
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Send,
  Loader2,
  RefreshCw,
  Users,
  MessageCircle,
  ArrowDown,
  CheckCheck,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import { waAdminApi } from '../services/waAdminApiService';
import type { WaMonitoredGroup } from '../types/wa-admin.types';
import { log } from '@/lib/logger';

interface ChatMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  sender_jid: string | null;
  sender_name: string | null;
  message_content: string;
  message_type: string;
  status: string;
  created_at: string;
}

const ChatTab: React.FC = () => {
  const [groups, setGroups] = useState<WaMonitoredGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastMessageTime = useRef<string | null>(null);

  // Fetch groups on mount
  const fetchGroups = useCallback(async () => {
    const result = await waAdminApi.groups.list(true);
    if (result.success && result.data) {
      const data = result.data;
      setGroups(data);
      // Auto-select Velo Server group if available
      const veloTest = data.find(g =>
        g.group_name?.toLowerCase().includes('velo server') ||
        g.project_name?.toLowerCase().includes('velo')
      );
      if (veloTest) {
        setSelectedGroup(veloTest.id);
      } else if (data.length > 0 && data[0]) {
        setSelectedGroup(data[0].id);
      }
    }
    setLoading(false);
  }, []);

  // Fetch messages for selected group
  const fetchMessages = useCallback(async (since?: string) => {
    if (!selectedGroup) return;

    if (!since) {
      setLoadingMessages(true);
    }

    try {
      const params = new URLSearchParams({ group_id: selectedGroup });
      if (since) {
        params.set('since', since);
      }

      const response = await fetch(`/api/communications/whatsapp/chat?${params}`);
      const result = await response.json();

      if (result.success && result.data) {
        if (since) {
          // Append new messages
          if (result.data.messages.length > 0) {
            setMessages(prev => [...prev, ...result.data.messages]);
            lastMessageTime.current = result.data.messages[result.data.messages.length - 1].created_at;
          }
        } else {
          // Replace all messages
          setMessages(result.data.messages);
          if (result.data.messages.length > 0) {
            lastMessageTime.current = result.data.messages[result.data.messages.length - 1].created_at;
          }
        }
      }
    } catch (error) {
      log.error('Failed to fetch messages', { error }, 'ChatTab');
    }

    setLoadingMessages(false);
  }, [selectedGroup]);

  // Initial load
  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  // Fetch messages when group changes
  useEffect(() => {
    if (selectedGroup) {
      lastMessageTime.current = null;
      fetchMessages();
    }
  }, [selectedGroup, fetchMessages]);

  // Auto-refresh polling
  useEffect(() => {
    if (!autoRefresh || !selectedGroup) return;

    const interval = setInterval(() => {
      if (lastMessageTime.current) {
        fetchMessages(lastMessageTime.current);
      }
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(interval);
  }, [autoRefresh, selectedGroup, fetchMessages]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current && !showScrollButton) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, showScrollButton]);

  // Handle scroll to detect if user scrolled up
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setShowScrollButton(!isNearBottom);
  }, []);

  // Scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollButton(false);
  };

  // Send message
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedGroup || !newMessage.trim()) return;

    setSending(true);

    const result = await waAdminApi.messages.send({
      group_id: selectedGroup,
      message: newMessage.trim(),
    });

    if (result.success) {
      setNewMessage('');
      // Immediately fetch new messages
      setTimeout(() => fetchMessages(lastMessageTime.current || undefined), 500);
    } else {
      notificationService.error(`Failed to send: ${result.error}`);
    }

    setSending(false);
  };

  const selectedGroupData = groups.find(g => g.id === selectedGroup);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-280px)] min-h-[500px]">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-[var(--ff-border-light)]">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[var(--ff-text-secondary)]" />
            <select
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              className="px-3 py-1.5 border border-[var(--ff-border-medium)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
            >
              <option value="">Select a group...</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.group_name}{group.project_name ? ` (${group.project_name})` : ''}
                </option>
              ))}
            </select>
          </div>

          {selectedGroupData && (
            <span className="text-xs text-[var(--ff-text-secondary)] font-mono">
              {selectedGroupData.group_jid}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="w-4 h-4 rounded border-[var(--ff-border-medium)]"
            />
            Auto-refresh
          </label>

          <button
            onClick={() => fetchMessages()}
            disabled={loadingMessages}
            className="p-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
            title="Refresh messages"
          >
            <RefreshCw className={`w-4 h-4 ${loadingMessages ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto py-4 space-y-3 relative"
      >
        {!selectedGroup ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--ff-text-secondary)]">
            <MessageCircle className="w-12 h-12 mb-4 opacity-50" />
            <p>Select a group to view messages</p>
          </div>
        ) : loadingMessages && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--ff-text-secondary)]">
            <MessageCircle className="w-12 h-12 mb-4 opacity-50" />
            <p>No messages yet</p>
            <p className="text-sm mt-1">Messages will appear here when received</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 p-2 bg-[var(--ff-primary)] text-white rounded-full shadow-lg hover:bg-[var(--ff-primary-dark)] transition-colors"
          >
            <ArrowDown className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Message Input */}
      <form onSubmit={handleSend} className="pt-4 border-t border-[var(--ff-border-light)]">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder={selectedGroup ? "Type a message..." : "Select a group first"}
            disabled={!selectedGroup || sending}
            className="flex-1 px-4 py-3 border border-[var(--ff-border-medium)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!selectedGroup || !newMessage.trim() || sending}
            className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {sending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

/**
 * Message Bubble Component
 */
interface MessageBubbleProps {
  message: ChatMessage;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isOutbound = message.direction === 'outbound';
  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[70%] rounded-lg px-4 py-2 ${
          isOutbound
            ? 'bg-green-500 text-white rounded-br-none'
            : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] rounded-bl-none'
        }`}
      >
        {/* Sender name for inbound messages */}
        {!isOutbound && message.sender_name && (
          <p className="text-xs font-medium text-[var(--ff-primary)] mb-1">
            {message.sender_name}
          </p>
        )}

        {/* Message content */}
        <p className="text-sm whitespace-pre-wrap break-words">
          {message.message_content}
        </p>

        {/* Time and status */}
        <div className={`flex items-center justify-end gap-1 mt-1 ${
          isOutbound ? 'text-green-100' : 'text-[var(--ff-text-secondary)]'
        }`}>
          <span className="text-xs">{time}</span>
          {isOutbound && (
            <MessageStatus status={message.status} />
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Message Status Icon
 */
const MessageStatus: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case 'sent':
    case 'delivered':
      return <CheckCheck className="w-3 h-3" />;
    case 'pending':
      return <Clock className="w-3 h-3" />;
    case 'failed':
      return <AlertCircle className="w-3 h-3 text-red-300" />;
    default:
      return null;
  }
};

export default ChatTab;
