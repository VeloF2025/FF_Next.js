import React, { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { VelocityButton } from '@/components/ui/VelocityButton';

interface Message {
  id: string;
  from: string;
  subject: string;
  content: string;
  date: string;
  read: boolean;
}

export const MessagesTab: React.FC = () => {
  const [messages] = useState<Message[]>([
    {
      id: '1',
      from: 'Procurement Team',
      subject: 'RFQ-2024-001 Clarification Required',
      content: 'We need clarification on the delivery timeline for fiber optic cables...',
      date: '2024-08-20',
      read: false
    },
    {
      id: '2',
      from: 'Project Manager',
      subject: 'Payment Terms Update',
      content: 'Please review the updated payment terms for your recent submission...',
      date: '2024-08-18',
      read: true
    }
  ]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-foreground">Messages</h2>
        <VelocityButton>
          <MessageSquare className="h-4 w-4 mr-2" />
          New Message
        </VelocityButton>
      </div>

      <div className="space-y-4">
        {messages.map((message) => (
          <GlassCard key={message.id} className={!message.read ? 'ring-2 ring-blue-100' : ''}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-2">
                  <h3 className={`font-medium ${!message.read ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {message.subject}
                  </h3>
                  {!message.read && (
                    <span className="bg-blue-100 text-blue-600 text-xs px-2 py-0.5 rounded-full">
                      New
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-2">From: {message.from}</p>
                <p className="text-muted-foreground">{message.content}</p>
              </div>
              <div className="text-sm text-muted-foreground">
                {new Date(message.date).toISOString().split('T')[0]}
              </div>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
};
