import type { ProposalConflict } from '../types';
export function ConflictReview({ conflicts }: { conflicts: ProposalConflict[] }) {
  if (!conflicts.length) return null;
  return <div className="space-y-2" aria-label="Assignment conflicts">{conflicts.map((item, index) => <p key={`${item.code}-${index}`} className={item.level === 'blocking' ? 'text-red-300' : 'text-amber-300'}>{item.level === 'blocking' ? 'Blocked' : 'Warning'}: {item.message}</p>)}</div>;
}
