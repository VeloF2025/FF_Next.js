/**
 * Participants Section Component
 * Dynamic participants management with add/remove functionality
 */

import { Plus, Trash2 } from 'lucide-react';

interface ParticipantsSectionProps {
  participants: string[];
  onAddParticipant: () => void;
  onRemoveParticipant: (index: number) => void;
  onUpdateParticipant: (index: number, value: string) => void;
}

export function ParticipantsSection({
  participants,
  onAddParticipant,
  onRemoveParticipant,
  onUpdateParticipant,
}: ParticipantsSectionProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-[var(--ff-text-primary)]">
          Participants
        </label>
        <button
          type="button"
          onClick={onAddParticipant}
          className="flex items-center text-sm text-blue-600 hover:text-blue-800"
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Participant
        </button>
      </div>
      <div className="space-y-2">
        {participants.map((participant, index) => (
          <div key={index} className="flex items-center space-x-2">
            <input
              value={participant}
              onChange={(e) => onUpdateParticipant(index, e.target.value)}
              className="flex-1 px-3 py-2 border border-[var(--ff-border-light)] rounded-md bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Participant name or email"
            />
            <button
              type="button"
              onClick={() => onRemoveParticipant(index)}
              className="p-2 text-[var(--ff-text-tertiary)] hover:text-red-600"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}