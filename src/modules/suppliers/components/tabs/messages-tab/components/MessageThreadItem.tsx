// ============= Message Thread Item Component =============
// Single thread item in the message list

import React from 'react';
import { Building2, Paperclip, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MessageThread } from '../types/messages.types';
import { statusConfig } from '../data/statusConfig';
import { priorityConfig } from '../data/priorityConfig';
import { categoryConfig } from '../data/categoryConfig';
import { formatMessageTime } from '../utils/messageHelpers';

interface MessageThreadItemProps {
  thread: MessageThread;
  isSelected: boolean;
  onClick: () => void;
}

export const MessageThreadItem: React.FC<MessageThreadItemProps> = ({
  thread,
  isSelected,
  onClick
}) => {
  const priority = priorityConfig[thread.lastMessage.priority];
  const category = categoryConfig[thread.lastMessage.category];
  const status = statusConfig[thread.lastMessage.status];
  const StatusIcon = status.icon;

  return (
    <div
      className={cn(
        "p-4 border-b border-border cursor-pointer transition-all hover:bg-background",
        isSelected ? "bg-blue-50 border-blue-200" : ""
      )}
      onClick={onClick}
    >
      <div className="flex items-start space-x-3">
        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
          <Building2 className="w-5 h-5 text-blue-600" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-1">
                <h3 className={cn("font-medium text-sm truncate", !thread.lastMessage.isRead ? "text-foreground" : "text-muted-foreground")}>
                  {thread.supplierName}
                </h3>
                <div className={cn("w-2 h-2 rounded-full flex-shrink-0", priority.dot)} />
                {thread.lastMessage.isStarred && (
                  <Star className="w-3 h-3 text-yellow-500 fill-current flex-shrink-0" />
                )}
              </div>

              <p className={cn("text-sm font-medium truncate", !thread.lastMessage.isRead ? "text-foreground" : "text-muted-foreground")}>
                {thread.subject}
              </p>

              <p className="text-sm text-muted-foreground truncate mt-1">
                {thread.lastMessage.content}
              </p>

              <div className="flex items-center space-x-2 mt-2">
                <span className={cn("px-2 py-1 rounded-full text-xs font-medium", category.color)}>
                  {category.label}
                </span>
                {thread.lastMessage.attachments > 0 && (
                  <div className="flex items-center text-xs text-muted-foreground">
                    <Paperclip className="w-3 h-3 mr-1" />
                    {thread.lastMessage.attachments}
                  </div>
                )}
              </div>
            </div>

            <div className="text-right flex-shrink-0 ml-2">
              <div className="text-xs text-muted-foreground mb-1">
                {formatMessageTime(thread.lastMessage.timestamp)}
              </div>

              <div className="flex items-center justify-end space-x-1">
                <StatusIcon className={cn("w-3 h-3", status.color)} />
                {thread.unreadCount > 0 && (
                  <span className="bg-blue-600 text-white text-xs rounded-full px-2 py-0.5 min-w-[20px] text-center">
                    {thread.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
