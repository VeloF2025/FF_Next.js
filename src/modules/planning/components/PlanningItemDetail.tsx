'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePlanningItem, useUpdatePlanningItem } from '../hooks/usePlanningItem';
import { BOARD_STAGES, STAGE_FLOW, STAGE_LABELS } from '../constants/stages';
import type { BoardStage, ChecklistItem, PlanningStage, StageChecklists } from '../types/planning';
import { log } from '@/lib/logger';

export function PlanningItemDetail({ itemId }: { itemId: string }) {
  const { data: item, isLoading } = usePlanningItem(itemId);
  const update = useUpdatePlanningItem();
  const [openStage, setOpenStage] = useState<BoardStage | null>(null);

  if (isLoading) return <div>Loading…</div>;
  if (!item) return <div>Planning item not found. <Link href="/planning" className="text-blue-600">Back to board</Link></div>;

  const currentIndex = STAGE_FLOW.indexOf(item.stage as BoardStage);

  const moveStage = async (next: PlanningStage) => {
    try { await update.mutateAsync({ id: itemId, payload: { stage: next } }); }
    catch (e) { log.error('Failed to move stage', { e, itemId, next }, 'PlanningItemDetail'); }
  };

  const toggleChecklist = async (stage: BoardStage, checkId: string) => {
    const checklists: StageChecklists = JSON.parse(JSON.stringify(item.stage_checklists));
    const list = checklists[stage] || [];
    const target = list.find((c: ChecklistItem) => c.id === checkId);
    if (!target) return;
    target.done = !target.done;
    try { await update.mutateAsync({ id: itemId, payload: { stage_checklists: checklists } }); }
    catch (e) { log.error('Failed to toggle checklist', { e, itemId, checkId }, 'PlanningItemDetail'); }
  };

  return (
    <div className="max-w-4xl">
      <Link href="/planning" className="text-sm text-blue-600">← Back to board</Link>
      <div className="flex items-center justify-between mt-2">
        <div>
          <h1 className="text-xl font-semibold">{item.title}</h1>
          <p className="text-sm text-gray-500">{item.item_uid} · {item.project_name} · {item.scope_area}</p>
        </div>
        <span className="px-3 py-1 rounded-full bg-gray-100 text-sm">{STAGE_LABELS[item.stage]}</span>
      </div>

      <div className="flex gap-2 my-4">
        <button
          disabled={currentIndex <= 0}
          onClick={() => { const s = STAGE_FLOW[currentIndex - 1]; if (s) moveStage(s); }}
          className="px-3 py-2 border rounded-md text-sm disabled:opacity-40"
        >← Previous stage</button>
        <button
          disabled={currentIndex < 0 || currentIndex >= STAGE_FLOW.length - 1}
          onClick={() => { const s = STAGE_FLOW[currentIndex + 1]; if (s) moveStage(s); }}
          className="px-3 py-2 border rounded-md text-sm disabled:opacity-40"
        >Next stage →</button>
      </div>

      <div className="space-y-2">
        {BOARD_STAGES.map(({ key, label }) => {
          const items = item.stage_checklists[key] || [];
          const isOpen = openStage === key;
          const doneCount = items.filter((c) => c.done).length;
          return (
            <div key={key} className="border rounded-md">
              <button onClick={() => setOpenStage(isOpen ? null : key)} className="w-full flex justify-between px-4 py-3 text-left">
                <span className="font-medium">{label}</span>
                <span className="text-sm text-gray-500">{doneCount}/{items.length}</span>
              </button>
              {isOpen && (
                <ul className="px-4 pb-3 space-y-1">
                  {items.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={c.done} onChange={() => toggleChecklist(key, c.id)} />
                      <span className={c.kind === 'gate' ? 'font-semibold' : ''}>{c.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
