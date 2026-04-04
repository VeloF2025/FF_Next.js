// ============= Message Detail View Component =============
// Right panel showing full conversation and reply box

import React, { useState } from 'react';
import {
  MessageSquare,
  Building2,
  Star,
  Archive,
  MoreVertical,
  User,
  Paperclip,
  Send
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { MessageThread } from '../types/messages.types';
import { priorityConfig } from '../data/priorityConfig';
import { categoryConfig } from '../data/categoryConfig';

interface MessageDetailViewProps {
  thread: MessageThread | null;
}

export const MessageDetailView: React.FC<MessageDetailViewProps> = ({ thread }) => {
  const [newMessage, setNewMessage] = useState('');

  if (!thread) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <MessageSquare className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">Select a Conversation</h3>
          <p className="text-muted-foreground">Choose a message thread to view and respond to communications.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-card">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <Building2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">{thread.subject}</h2>
              <p className="text-sm text-muted-foreground">{thread.supplierName}</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Button variant="ghost" size="icon" aria-label="Star"><Star className="w-4 h-4" /></Button>
            <Button variant="ghost" size="icon" aria-label="Archive"><Archive className="w-4 h-4" /></Button>
            <Button variant="ghost" size="icon" aria-label="More options"><MoreVertical className="w-4 h-4" /></Button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="bg-blue-50 p-4 rounded-lg">
          <div className="flex items-start space-x-3">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <User className="w-4 h-4 text-blue-600" />
            </div>
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-2">
                <span className="font-medium text-sm text-foreground">{thread.lastMessage.sender.name}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(thread.lastMessage.timestamp).toLocaleString()}
                </span>
                <span className={cn("px-2 py-1 rounded-full text-xs font-medium", priorityConfig[thread.lastMessage.priority].color)}>
                  {priorityConfig[thread.lastMessage.priority].label}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{thread.lastMessage.content}</p>

              {thread.lastMessage.attachments > 0 && (
                <div className="mt-3 p-3 bg-card border border-border rounded-md">
                  <div className="flex items-center space-x-2">
                    <Paperclip className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-muted-foreground">{thread.lastMessage.attachments} attachment(s)</span>
                    <Button variant="ghost" size="sm">Download</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Reply Box */}
      <div className="p-6 border-t border-border">
        <div className="space-y-4">
          <div className="flex items-center space-x-4">
            <select className="border border-border rounded-md px-3 py-2 text-sm">
              <option value="medium">Medium Priority</option>
              <option value="low">Low Priority</option>
              <option value="high">High Priority</option>
              <option value="urgent">Urgent Priority</option>
            </select>

            <select className="border border-border rounded-md px-3 py-2 text-sm">
              <option value="general">General</option>
              {Object.entries(categoryConfig).map(([key, config]) => (
                <option key={key} value={key}>{config.label}</option>
              ))}
            </select>
          </div>

          <div className="border border-border rounded-lg">
            <textarea
              className="w-full p-3 border-0 resize-none focus:outline-none focus:ring-0"
              rows={4}
              placeholder="Type your reply..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
            />

            <div className="flex items-center justify-between px-3 py-2 bg-background border-t border-border">
              <div className="flex items-center space-x-2">
                <Button variant="ghost" size="icon" aria-label="Attach file"><Paperclip className="w-4 h-4" /></Button>
              </div>

              <div className="flex items-center space-x-2">
                <Button variant="ghost" size="sm">Save Draft</Button>
                <Button disabled={!newMessage.trim()} className="flex items-center space-x-2"><Send className="w-4 h-4" /><span>Send</span></Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
