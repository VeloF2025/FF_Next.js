import { Plus, Edit2, Trash2 } from 'lucide-react';
import { PositionConfig } from '@/types/staff-hierarchy.types';

interface PositionsTabProps {
  positions: PositionConfig[];
  onAdd: () => void;
  onEdit: (position: PositionConfig) => void;
  onDelete: (id: string) => void;
  onInitialize: () => void;
}

export function PositionsTab({ positions, onAdd, onEdit, onDelete, onInitialize }: PositionsTabProps) {
  // Group positions by level
  const positionsByLevel = positions.reduce((acc: Record<string, PositionConfig[]>, pos: PositionConfig) => {
    const level = `Level ${pos.level}`;
    if (!acc[level]) acc[level] = [];
    acc[level].push(pos);
    return acc;
  }, {});

  const levelNames: Record<number, string> = {
    1: 'Executive',
    2: 'C-Suite',
    3: 'Heads/Directors',
    4: 'Managers',
    5: 'Senior Staff',
    6: 'Mid Level',
    7: 'Support',
    8: 'Other'
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">Position Management</h2>
        <div className="space-x-2">
          {positions.length === 0 && (
            <button
              onClick={onInitialize}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Initialize Default Positions
            </button>
          )}
          <button
            onClick={onAdd}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Position
          </button>
        </div>
      </div>

      {Object.entries(positionsByLevel).map(([level, levelPositions]) => {
        const levelNum = parseInt(level.replace('Level ', ''));
        return (
          <div key={level} className="mb-6">
            <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-3">
              {levelNames[levelNum]} ({level})
            </h3>
            <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {levelPositions.map((position) => (
                  <PositionCard
                    key={position.id}
                    position={position}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface PositionCardProps {
  position: PositionConfig;
  onEdit: (position: PositionConfig) => void;
  onDelete: (id: string) => void;
}

function PositionCard({ position, onEdit, onDelete }: PositionCardProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-3 border border-[var(--ff-border-light)] flex justify-between items-center">
      <div>
        <span className="font-medium text-[var(--ff-text-primary)]">{position.name}</span>
        {position.department && (
          <span className="text-sm text-[var(--ff-text-secondary)] ml-2">({position.department})</span>
        )}
      </div>
      <div className="flex space-x-1">
        <button
          onClick={() => onEdit(position)}
          className="p-1 text-[var(--ff-text-tertiary)] hover:text-blue-600"
          aria-label={`Edit ${position.name} position`}
        >
          <Edit2 className="w-4 h-4" />
        </button>
        <button
          onClick={() => onDelete(position.id)}
          className="p-1 text-[var(--ff-text-tertiary)] hover:text-red-600"
          aria-label={`Delete ${position.name} position`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}