/**
 * Email tab for the Communications Hub
 * Sub-tabs: Compose | Sent
 */

import { useState } from 'react';
import { PenLine, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmailComposeForm } from './EmailComposeForm';
import { EmailOutboxList } from './EmailOutboxList';

type SubTab = 'compose' | 'sent';

export function EmailTab() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('compose');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleEmailSent = () => {
    setRefreshKey(k => k + 1);
    setActiveSubTab('sent');
  };

  return (
    <div className="space-y-4">
      {/* Sub-tab navigation */}
      <div className="flex items-center gap-1 border-b border-[var(--ff-border-light)]">
        <button
          type="button"
          onClick={() => setActiveSubTab('compose')}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
            activeSubTab === 'compose'
              ? 'border-[var(--ff-primary)] text-[var(--ff-primary)]'
              : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
          )}
        >
          <PenLine className="w-4 h-4" />
          Compose
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('sent')}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
            activeSubTab === 'sent'
              ? 'border-[var(--ff-primary)] text-[var(--ff-primary)]'
              : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
          )}
        >
          <Send className="w-4 h-4" />
          Sent
        </button>
      </div>

      {/* Sub-tab content */}
      {activeSubTab === 'compose' && (
        <EmailComposeForm onSent={handleEmailSent} />
      )}
      {activeSubTab === 'sent' && (
        <EmailOutboxList key={refreshKey} />
      )}
    </div>
  );
}
