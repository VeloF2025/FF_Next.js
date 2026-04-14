/**
 * Use Meeting Form Hook
 * Custom hook for meeting form state management and logic
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { Meeting } from '../types/meeting.types';

type FormData = Omit<Meeting, 'id' | 'actionItems' | 'date'> & {
  date: string;
  actionItems: string[];
};

interface UseMeetingFormProps {
  meeting?: Meeting;
  onSave: (meeting: Partial<Meeting>) => void;
  onClose: () => void;
}

export function useMeetingForm({ meeting, onSave, onClose }: UseMeetingFormProps) {
  const [agendaItems, setAgendaItems] = useState<string[]>(meeting?.agenda || ['']);
  const [participants, setParticipants] = useState<string[]>(meeting?.participants || ['']);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    defaultValues: meeting ? {
      ...meeting,
      date: meeting.date instanceof Date ? meeting.date.toISOString().split('T')[0] : (meeting.date as string),
      actionItems: meeting.actionItems.map(ai => ai.task)
    } : {
      type: 'team',
      isVirtual: false,
      status: 'scheduled'
    }
  });

  const isVirtual = watch('isVirtual');

  const onSubmit = (data: FormData) => {
    const meetingData: Partial<Meeting> = {
      ...data,
      date: data.date ? new Date(data.date) : new Date(),
      agenda: agendaItems.filter(item => item.trim()),
      participants: participants.filter(p => p.trim()),
      actionItems: meeting?.actionItems || []
    };
    
    onSave(meetingData);
    onClose();
  };

  const addAgendaItem = () => {
    setAgendaItems([...agendaItems, '']);
  };

  const removeAgendaItem = (index: number) => {
    setAgendaItems(agendaItems.filter((_, i) => i !== index));
  };

  const updateAgendaItem = (index: number, value: string) => {
    const newItems = [...agendaItems];
    newItems[index] = value;
    setAgendaItems(newItems);
  };

  const addParticipant = () => {
    setParticipants([...participants, '']);
  };

  const removeParticipant = (index: number) => {
    setParticipants(participants.filter((_, i) => i !== index));
  };

  const updateParticipant = (index: number, value: string) => {
    const newParticipants = [...participants];
    newParticipants[index] = value;
    setParticipants(newParticipants);
  };

  return {
    // Form handling
    register,
    handleSubmit,
    onSubmit,
    errors,
    isVirtual,
    
    // Agenda items
    agendaItems,
    addAgendaItem,
    removeAgendaItem,
    updateAgendaItem,
    
    // Participants
    participants,
    addParticipant,
    removeParticipant,
    updateParticipant,
  };
}