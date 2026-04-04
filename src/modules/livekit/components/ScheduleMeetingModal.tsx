// Schedule Meeting Modal Component
// Form for scheduling a new meeting with attendees
// WCAG 2.1 AA — uses AccessibleModal (role=dialog, focus trap, Escape, focus restore)

'use client';

import { useState } from 'react';
import {
    Calendar,
    Clock,
    Users,
    Mail,
    Plus,
    Trash2,
    CheckCircle,
    AlertCircle,
} from 'lucide-react';
import { AccessibleModal } from '@/components/accessible';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';

interface Attendee {
    email: string;
    name?: string;
}

interface ScheduleMeetingModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: (meeting: any) => void;
}

export function ScheduleMeetingModal({ isOpen, onClose, onSuccess }: ScheduleMeetingModalProps) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [duration, setDuration] = useState(60);
    const [attendees, setAttendees] = useState<Attendee[]>([]);
    const [newEmail, setNewEmail] = useState('');
    const [newName, setNewName] = useState('');

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<{ meetingUrl: string; calendarLinks: any } | null>(null);

    const handleAddAttendee = () => {
        if (!newEmail.trim()) return;

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(newEmail)) {
            setError('Please enter a valid email address');
            return;
        }

        if (attendees.some(a => a.email.toLowerCase() === newEmail.toLowerCase())) {
            setError('This email is already added');
            return;
        }

        setAttendees([...attendees, { email: newEmail.trim(), name: newName.trim() || undefined }]);
        setNewEmail('');
        setNewName('');
        setError(null);
    };

    const handleRemoveAttendee = (index: number) => {
        setAttendees(attendees.filter((_, i) => i !== index));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            if (!title.trim()) throw new Error('Meeting title is required');
            if (!date || !time) throw new Error('Date and time are required');

            const scheduledAt = new Date(`${date}T${time}`).toISOString();

            const response = await fetch('/api/livekit/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title.trim(),
                    description: description.trim() || undefined,
                    scheduledAt,
                    durationMinutes: duration,
                    attendees,
                }),
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to schedule meeting');

            setSuccess({ meetingUrl: data.meetingUrl, calendarLinks: data.calendarLinks });
            if (onSuccess) onSuccess(data.meeting);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        setTitle('');
        setDescription('');
        setDate('');
        setTime('');
        setDuration(60);
        setAttendees([]);
        setNewEmail('');
        setNewName('');
        setError(null);
        setSuccess(null);
        onClose();
    };

    return (
        <AccessibleModal
            isOpen={isOpen}
            onClose={handleClose}
            title="Schedule Meeting"
            titleId="schedule-meeting-title"
            className="max-w-lg max-h-[90vh] overflow-y-auto"
        >
            {/* Success State */}
            {success ? (
                <div className="text-center">
                    <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle className="w-8 h-8 text-green-400" aria-hidden="true" />
                    </div>
                    <h3 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">
                        Meeting Scheduled!
                    </h3>
                    <p className="text-[var(--ff-text-secondary)] mb-4">
                        {attendees.length > 0
                            ? `Email invites have been sent to ${attendees.length} attendee(s).`
                            : 'Your meeting has been created.'}
                    </p>

                    <div className="bg-[var(--ff-surface-hover)] rounded-lg p-4 mb-4">
                        <p className="text-sm text-[var(--ff-text-secondary)] mb-2">Meeting Link:</p>
                        <a
                            href={success.meetingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:underline break-all focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] rounded"
                        >
                            {success.meetingUrl}
                        </a>
                    </div>

                    <div className="flex flex-wrap gap-2 justify-center mb-6">
                        <a
                            href={success.calendarLinks.googleCalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                        >
                            📅 Add to Google Calendar
                        </a>
                        <a
                            href={success.calendarLinks.outlookUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                        >
                            📧 Add to Outlook
                        </a>
                    </div>

                    <button
                        type="button"
                        onClick={handleClose}
                        className="w-full py-3 bg-[var(--ff-text-primary)] text-[var(--ff-surface)] rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                    >
                        Done
                    </button>
                </div>
            ) : (
                /* Form */
                <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                    {/* Error */}
                    {error && (
                        <div
                            role="alert"
                            aria-live="polite"
                            className="flex items-center gap-2 px-4 py-3 bg-red-500/20 text-red-400 rounded-lg text-sm"
                        >
                            <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                            {error}
                        </div>
                    )}

                    {/* Title */}
                    <div>
                        <label
                            htmlFor="meeting-title"
                            className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1"
                        >
                            Meeting Title{' '}
                            <span aria-hidden="true" className="text-red-400">*</span>
                        </label>
                        <input
                            id="meeting-title"
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Weekly Team Standup"
                            aria-required="true"
                            className="w-full px-4 py-2.5 border border-[var(--ff-border)] rounded-lg bg-[var(--ff-surface)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                            required
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label
                            htmlFor="meeting-description"
                            className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1"
                        >
                            Description{' '}
                            <span className="text-[var(--ff-text-secondary)] font-normal">(optional)</span>
                        </label>
                        <textarea
                            id="meeting-description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Discuss project updates and blockers"
                            rows={2}
                            className="w-full px-4 py-2.5 border border-[var(--ff-border)] rounded-lg bg-[var(--ff-surface)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] resize-none"
                        />
                    </div>

                    {/* Date & Time */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label
                                htmlFor="meeting-date"
                                className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1"
                            >
                                <Calendar className="w-4 h-4 inline mr-1" aria-hidden="true" />
                                Date{' '}
                                <span aria-hidden="true" className="text-red-400">*</span>
                            </label>
                            <input
                                id="meeting-date"
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                min={new Date().toISOString().split('T')[0]}
                                aria-required="true"
                                className="w-full px-4 py-2.5 border border-[var(--ff-border)] rounded-lg bg-[var(--ff-surface)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                                required
                            />
                        </div>
                        <div>
                            <label
                                htmlFor="meeting-time"
                                className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1"
                            >
                                <Clock className="w-4 h-4 inline mr-1" aria-hidden="true" />
                                Time{' '}
                                <span aria-hidden="true" className="text-red-400">*</span>
                            </label>
                            <input
                                id="meeting-time"
                                type="time"
                                value={time}
                                onChange={(e) => setTime(e.target.value)}
                                aria-required="true"
                                className="w-full px-4 py-2.5 border border-[var(--ff-border)] rounded-lg bg-[var(--ff-surface)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                                required
                            />
                        </div>
                    </div>

                    {/* Duration */}
                    <div>
                        <label
                            htmlFor="meeting-duration"
                            className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1"
                        >
                            Duration
                        </label>
                        <select
                            id="meeting-duration"
                            value={duration}
                            onChange={(e) => setDuration(Number(e.target.value))}
                            className="w-full px-4 py-2.5 border border-[var(--ff-border)] rounded-lg bg-[var(--ff-surface)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                        >
                            <option value={15}>15 minutes</option>
                            <option value={30}>30 minutes</option>
                            <option value={45}>45 minutes</option>
                            <option value={60}>1 hour</option>
                            <option value={90}>1.5 hours</option>
                            <option value={120}>2 hours</option>
                        </select>
                    </div>

                    {/* Attendees */}
                    <fieldset>
                        <legend className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                            <Users className="w-4 h-4 inline mr-1" aria-hidden="true" />
                            Invite Attendees
                        </legend>

                        {/* Add attendee */}
                        <div className="flex gap-2 mb-3" role="group" aria-label="Add attendee">
                            <label htmlFor="attendee-email" className="sr-only">
                                Attendee email address
                            </label>
                            <input
                                id="attendee-email"
                                type="email"
                                value={newEmail}
                                onChange={(e) => setNewEmail(e.target.value)}
                                placeholder="email@example.com"
                                className="flex-1 px-4 py-2 border border-[var(--ff-border)] rounded-lg bg-[var(--ff-surface)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] text-sm"
                            />
                            <label htmlFor="attendee-name" className="sr-only">
                                Attendee name (optional)
                            </label>
                            <input
                                id="attendee-name"
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="Name (optional)"
                                className="w-32 px-4 py-2 border border-[var(--ff-border)] rounded-lg bg-[var(--ff-surface)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] text-sm"
                            />
                            <button
                                type="button"
                                onClick={handleAddAttendee}
                                aria-label="Add attendee"
                                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                            >
                                <Plus className="w-4 h-4" aria-hidden="true" />
                            </button>
                        </div>

                        {/* Attendees list */}
                        {attendees.length > 0 ? (
                            <ul className="space-y-2" aria-label="Invited attendees">
                                {attendees.map((attendee, index) => (
                                    <li
                                        key={index}
                                        className="flex items-center justify-between px-3 py-2 bg-[var(--ff-surface-hover)] rounded-lg"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Mail className="w-4 h-4 text-[var(--ff-text-secondary)]" aria-hidden="true" />
                                            <span className="text-sm text-[var(--ff-text-primary)]">
                                                {attendee.name
                                                    ? `${attendee.name} (${attendee.email})`
                                                    : attendee.email}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveAttendee(index)}
                                            aria-label={`Remove ${attendee.name ?? attendee.email}`}
                                            className="p-1 text-[var(--ff-text-secondary)] hover:text-red-400 rounded focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                                        >
                                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-sm text-[var(--ff-text-secondary)] italic">
                                No attendees added. You can schedule without inviting anyone.
                            </p>
                        )}
                    </fieldset>

                    {/* Footer actions */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="flex-1 py-2.5 border border-[var(--ff-border)] text-[var(--ff-text-primary)] rounded-lg hover:bg-[var(--ff-surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            aria-disabled={loading}
                            className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                        >
                            {loading ? (
                                <>
                                    <InlineSpinner size="sm" />
                                    Scheduling…
                                </>
                            ) : (
                                <>
                                    <Calendar className="w-4 h-4" aria-hidden="true" />
                                    Schedule Meeting
                                </>
                            )}
                        </button>
                    </div>
                </form>
            )}
        </AccessibleModal>
    );
}

export default ScheduleMeetingModal;
