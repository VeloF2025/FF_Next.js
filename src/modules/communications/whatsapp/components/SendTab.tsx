/**
 * Send Tab - Compose and send WhatsApp messages to groups
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Send,
  CheckCircle,
  AlertCircle,
  Users,
  MessageSquare,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import { waAdminApi } from '../services/waAdminApiService';
import type { WaMonitoredGroup, WaMessageLog } from '../types/wa-admin.types';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';

interface SendMessageInput {
  group_id: string;
  message: string;
  mention_phone?: string;
}

const SendTab: React.FC = () => {
  const [groups, setGroups] = useState<WaMonitoredGroup[]>([]);
  const [recentMessages, setRecentMessages] = useState<WaMessageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [message, setMessage] = useState('');
  const [mentionPhone, setMentionPhone] = useState('');
  const [charCount, setCharCount] = useState(0);

  const MAX_MESSAGE_LENGTH = 4096;

  const fetchGroups = useCallback(async () => {
    const result = await waAdminApi.groups.list(true); // Only active groups
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
  }, []);

  const fetchRecentMessages = useCallback(async () => {
    const result = await waAdminApi.logs.list({
      direction: 'outbound',
      message_type: 'custom',
      limit: 10,
    });
    if (result.success && result.data) {
      setRecentMessages(result.data);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchGroups(), fetchRecentMessages()]);
      setLoading(false);
    };
    loadData();
  }, [fetchGroups, fetchRecentMessages]);

  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= MAX_MESSAGE_LENGTH) {
      setMessage(value);
      setCharCount(value.length);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedGroup) {
      notificationService.error('Please select a group');
      return;
    }

    if (!message.trim()) {
      notificationService.error('Please enter a message');
      return;
    }

    setSending(true);

    const input: SendMessageInput = {
      group_id: selectedGroup,
      message: message.trim(),
    };

    if (mentionPhone.trim()) {
      // Format phone number: remove spaces, ensure starts with country code
      let phone = mentionPhone.trim().replace(/\s+/g, '');
      if (phone.startsWith('0')) {
        phone = '27' + phone.substring(1); // SA country code
      }
      if (!phone.startsWith('+')) {
        phone = phone; // Keep as-is if no + prefix
      } else {
        phone = phone.substring(1); // Remove + prefix
      }
      input.mention_phone = phone;
    }

    const result = await waAdminApi.messages.send(input);

    if (result.success) {
      notificationService.success('Message sent successfully!');
      setMessage('');
      setMentionPhone('');
      setCharCount(0);
      // Refresh recent messages
      fetchRecentMessages();
    } else {
      notificationService.error(`Failed to send: ${result.error}`);
    }

    setSending(false);
  };

  const selectedGroupData = groups.find(g => g.id === selectedGroup);

  if (loading) {
    return (
      <LoadingSpinner className="py-12" size="lg" label="" />
    );
  }

  return (
    <div className="space-y-6">
      {/* Compose Message Card */}
      <div className="bg-[var(--ff-bg-card)] border border-[var(--ff-border-light)] rounded-lg p-6">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4 flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-[var(--ff-primary)]" />
          Compose Message
        </h3>

        <form onSubmit={handleSend} className="space-y-4">
          {/* Group Selection */}
          <div>
            <label htmlFor="group" className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Select Group *
            </label>
            <div className="relative">
              <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-secondary)]" />
              <select
                id="group"
                value={selectedGroup}
                onChange={(e) => setSelectedGroup(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-medium)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
                required
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
              <p className="mt-1 text-xs text-[var(--ff-text-secondary)] font-mono">
                JID: {selectedGroupData.group_jid}
              </p>
            )}
          </div>

          {/* Optional Mention */}
          <div>
            <label htmlFor="mention" className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              @Mention Phone Number <span className="text-[var(--ff-text-secondary)]">(optional)</span>
            </label>
            <input
              id="mention"
              type="text"
              value={mentionPhone}
              onChange={(e) => setMentionPhone(e.target.value)}
              placeholder="e.g., 0712345678 or 27712345678"
              className="w-full px-4 py-2 border border-[var(--ff-border-medium)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
            />
            <p className="mt-1 text-xs text-[var(--ff-text-secondary)]">
              Leave empty to send without @mentioning anyone
            </p>
          </div>

          {/* Message Content */}
          <div>
            <label htmlFor="message" className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Message *
            </label>
            <textarea
              id="message"
              value={message}
              onChange={handleMessageChange}
              rows={6}
              placeholder="Type your message here...

You can use *bold*, _italic_, ~strikethrough~, and ```code``` formatting."
              className="w-full px-4 py-3 border border-[var(--ff-border-medium)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)] resize-none font-mono text-sm"
              required
            />
            <div className="flex justify-between items-center mt-1">
              <p className="text-xs text-[var(--ff-text-secondary)]">
                Supports WhatsApp formatting: *bold*, _italic_, ~strikethrough~, ```code```
              </p>
              <span className={`text-xs ${charCount > MAX_MESSAGE_LENGTH * 0.9 ? 'text-amber-500' : 'text-[var(--ff-text-secondary)]'}`}>
                {charCount}/{MAX_MESSAGE_LENGTH}
              </span>
            </div>
          </div>

          {/* Send Button */}
          <div className="flex items-center justify-end gap-4 pt-2">
            <button
              type="button"
              onClick={() => {
                setMessage('');
                setMentionPhone('');
                setCharCount(0);
              }}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
            >
              Clear
            </button>
            <button
              type="submit"
              disabled={sending || !selectedGroup || !message.trim()}
              className="flex items-center gap-2 px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? (
                <>
                  <InlineSpinner size="sm" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Send Message
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Recent Sent Messages */}
      <div className="bg-[var(--ff-bg-card)] border border-[var(--ff-border-light)] rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
            <Clock className="w-5 h-5 text-[var(--ff-text-secondary)]" />
            Recent Sent Messages
          </h3>
          <button
            onClick={fetchRecentMessages}
            className="p-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {recentMessages.length === 0 ? (
          <p className="text-[var(--ff-text-secondary)] text-center py-8">
            No custom messages sent yet. Send your first message above!
          </p>
        ) : (
          <div className="space-y-3">
            {recentMessages.map((msg) => (
              <div
                key={msg.id}
                className="flex items-start gap-3 p-3 bg-[var(--ff-bg-secondary)] rounded-lg"
              >
                <div className="flex-shrink-0 mt-1">
                  {msg.status === 'sent' || msg.status === 'delivered' ? (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : msg.status === 'failed' ? (
                    <AlertCircle className="w-4 h-4 text-red-500" />
                  ) : (
                    <Clock className="w-4 h-4 text-amber-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-[var(--ff-text-primary)]">
                      {msg.project || 'Unknown Group'}
                    </span>
                    <span className="text-[var(--ff-text-secondary)]">•</span>
                    <span className="text-[var(--ff-text-secondary)]">
                      {new Date(msg.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--ff-text-secondary)] line-clamp-2">
                    {msg.message_content || '(No content)'}
                  </p>
                  {msg.error_message && (
                    <p className="mt-1 text-xs text-red-500">
                      Error: {msg.error_message}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tips Card */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
        <h4 className="font-medium text-blue-600 dark:text-blue-400 mb-2">Tips for WhatsApp Messages</h4>
        <ul className="text-sm text-[var(--ff-text-secondary)] space-y-1 list-disc list-inside">
          <li>Use <code className="bg-[var(--ff-bg-tertiary)] px-1 rounded">*text*</code> for <strong>bold</strong></li>
          <li>Use <code className="bg-[var(--ff-bg-tertiary)] px-1 rounded">_text_</code> for <em>italic</em></li>
          <li>Use <code className="bg-[var(--ff-bg-tertiary)] px-1 rounded">~text~</code> for <s>strikethrough</s></li>
          <li>Use <code className="bg-[var(--ff-bg-tertiary)] px-1 rounded">```text```</code> for monospace</li>
          <li>The Velo Test group is safe for testing messages</li>
        </ul>
      </div>
    </div>
  );
};

export default SendTab;
