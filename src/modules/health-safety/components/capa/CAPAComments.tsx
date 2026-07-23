/**
 * CAPA comments list
 */

import { MessageSquare } from 'lucide-react';
import type { CAPAComment } from '@/modules/health-safety/types/capa.types';

export function CAPAComments({ comments }: { comments: CAPAComment[] }) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider mb-4">
        <MessageSquare className="w-4 h-4" />
        Comments
      </h2>
      {comments.length === 0 ? (
        <p className="text-sm text-[var(--ff-text-tertiary)]">No comments yet</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="text-sm bg-[var(--ff-bg-tertiary)] rounded p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-[var(--ff-text-primary)]">{c.author_name || 'Unknown'}</span>
                <span className="text-xs text-[var(--ff-text-tertiary)]">
                  {new Date(c.created_at).toLocaleString()}
                </span>
              </div>
              <p className="text-[var(--ff-text-secondary)] whitespace-pre-wrap">{c.comment}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
