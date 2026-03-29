'use client';

import { MancoActionItem } from '@/types/manco-action-items.types';
import { isOverdue, daysUntilEta, formatDate, truncateText } from './manco-grid-helpers';

interface MancoKanbanViewProps {
  items: MancoActionItem[];
  onItemClick: (item: MancoActionItem) => void;
}

type ColumnType = 'pending' | 'in_progress' | 'completed' | 'overdue';

const COLUMNS: Array<{
  id: ColumnType;
  title: string;
  color: string;
}> = [
  { id: 'pending', title: 'Pending', color: 'var(--ff-warning)' },
  { id: 'in_progress', title: 'In Progress', color: 'var(--ff-info)' },
  { id: 'completed', title: 'Completed', color: 'var(--ff-success)' },
  { id: 'overdue', title: 'Overdue', color: 'var(--ff-error)' },
];

function KanbanCard({
  item,
  onClick,
}: {
  item: MancoActionItem;
  onClick: () => void;
}) {
  const overdue = isOverdue(item);
  const daysLeft = daysUntilEta(item);
  const etaColor = overdue ? 'var(--ff-error)' : daysLeft !== null && daysLeft <= 7 ? 'var(--ff-warning)' : 'var(--ff-text-secondary)';

  return (
    <div
      onClick={onClick}
      className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow mb-3"
    >
      {/* Title */}
      <p className="font-semibold text-sm text-[var(--ff-text-primary)] line-clamp-2 mb-2">
        {item.action_item}
      </p>

      {/* Department Badge */}
      {item.department && (
        <div className="inline-block px-2 py-1 text-xs font-medium rounded bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] mb-2 mr-1">
          {item.department}
        </div>
      )}

      {/* FF Module Badge */}
      {item.fibreflow_module && (
        <div className="inline-block px-2 py-1 text-xs font-medium rounded bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] mb-2">
          {item.fibreflow_module}
        </div>
      )}

      {/* Responsible Person */}
      {item.responsible_person && (
        <p className="text-xs text-[var(--ff-text-secondary)] mt-2 mb-2">
          {item.responsible_person}
        </p>
      )}

      {/* ETA */}
      {item.completion_eta && (
        <p className="text-xs font-medium mt-2" style={{ color: etaColor }}>
          ETA: {formatDate(item.completion_eta)}
        </p>
      )}
    </div>
  );
}

export function MancoKanbanView({ items, onItemClick }: MancoKanbanViewProps) {
  return (
    <div className="overflow-x-auto">
      <div className="flex gap-4 min-w-max p-2">
        {COLUMNS.map((column) => {
          let columnItems: MancoActionItem[];

          if (column.id === 'overdue') {
            columnItems = items.filter((i) => isOverdue(i));
          } else {
            columnItems = items.filter(
              (i) => !isOverdue(i) && i.status === column.id
            );
          }

          return (
            <div
              key={column.id}
              className="flex-1 min-w-[300px] bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--ff-border-light)]">
                <h3 className="font-semibold text-[var(--ff-text-primary)]">
                  {column.title}
                </h3>
                <span
                  className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white"
                  style={{ backgroundColor: column.color }}
                >
                  {columnItems.length}
                </span>
              </div>

              {/* Cards */}
              {columnItems.length === 0 ? (
                <p className="text-sm text-[var(--ff-text-secondary)] text-center py-8">
                  No items
                </p>
              ) : (
                <div>
                  {columnItems.map((item) => (
                    <KanbanCard
                      key={item.id}
                      item={item}
                      onClick={() => onItemClick(item)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
