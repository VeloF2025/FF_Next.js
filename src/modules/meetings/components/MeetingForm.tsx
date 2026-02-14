/**
 * Meeting Form - Legacy Compatibility Layer
 * @deprecated Use modular components from './forms' instead
 * This file maintains backward compatibility for existing imports
 * New code should import from './forms' directly
 */

import type { Meeting } from '../types/meeting.types';
import { 
  MeetingFormHeader,
  BasicMeetingFields,
  MeetingLocationFields,
  AgendaItemsSection,
  ParticipantsSection,
  MeetingNotesField,
  MeetingFormActions
} from './forms';
import { useMeetingForm } from '../hooks/useMeetingForm';

interface MeetingFormProps {
  meeting?: Meeting;
  isOpen: boolean;
  onClose: () => void;
  onSave: (meeting: Partial<Meeting>) => void;
}

export function MeetingForm({ meeting, isOpen, onClose, onSave }: MeetingFormProps) {
  const {
    register,
    handleSubmit,
    onSubmit,
    errors,
    isVirtual,
    agendaItems,
    addAgendaItem,
    removeAgendaItem,
    updateAgendaItem,
    participants,
    addParticipant,
    removeParticipant,
    updateParticipant,
  } = useMeetingForm({ 
    ...(meeting && { meeting }), 
    onSave, 
    onClose 
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <MeetingFormHeader isEditing={!!meeting} onClose={onClose} />

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          <BasicMeetingFields register={register} errors={errors} />

          <MeetingLocationFields register={register} isVirtual={isVirtual} />

          <AgendaItemsSection
            agendaItems={agendaItems}
            onAddItem={addAgendaItem}
            onRemoveItem={removeAgendaItem}
            onUpdateItem={updateAgendaItem}
          />

          <ParticipantsSection
            participants={participants}
            onAddParticipant={addParticipant}
            onRemoveParticipant={removeParticipant}
            onUpdateParticipant={updateParticipant}
          />

          <MeetingNotesField register={register} />

          <MeetingFormActions isEditing={!!meeting} onCancel={onClose} />
        </form>
      </div>
    </div>
  );
}