// ============= Empty States Components =============
// Empty state components for no supplier and no messages

import React from 'react';
import { MessageSquare } from 'lucide-react';

export const NoSupplierState: React.FC = () => {
  return (
    <div className="text-center py-12">
      <MessageSquare className="mx-auto h-12 w-12 text-gray-400 mb-4" />
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">Select a Supplier</h3>
      <p className="text-gray-600 dark:text-gray-400">
        Choose a supplier from the Company Profile tab to view message history and communicate with them.
      </p>
    </div>
  );
};

export const NoMessagesState: React.FC = () => {
  return (
    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
      <MessageSquare className="mx-auto h-8 w-8 text-gray-300 mb-3" />
      <p className="text-sm">No messages found</p>
    </div>
  );
};
