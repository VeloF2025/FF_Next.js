// Schedule Meeting Modal Component
// Form for scheduling a new meeting with attendees

'use client';

import { useState } from 'react';
import {
    X,
    Calendar,
    Clock,
    Users,
    Mail,
    Plus,
    Trash2,
    Loader2,
    CheckCircle,
    AlertCircle,
} from 'lucide-react';

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

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(newEmail)) {
            setError('Please enter a valid email address');
            return;
        }

        // Check for duplicates
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
            // Validate
            if (!title.trim()) {
                throw new Error('Meeting title is required');
            }
            if (!date || !time) {
                throw new Error('Date and time are required');
            }

            // Create ISO date string
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

            if (!response.ok) {
                throw new Error(data.error || 'Failed to schedule meeting');
            }

            setSuccess({
                meetingUrl: data.meetingUrl,
                calendarLinks: data.calendarLinks,
            });

            if (onSuccess) {
                onSuccess(data.meeting);
            }
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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-[var(--ff-bg-secondary)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ff-border-light)] bg-gradient-to-r from-blue-600 to-indigo-600">
                    <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                        <Calendar className="w-5 h-5" />
                        Schedule Meeting
                    </h2>
                    <button
                        onClick={handleClose}
                        className="p-1 text-white/80 hover:text-white rounded-lg hover:bg-white dark:bg-gray-800/10"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Success State */}
                {success ? (
                    <div className="p-6 text-center">
                        <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-8 h-8 text-green-400" />
                        </div>
                        <h3 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">Meeting Scheduled!</h3>
                        <p className="text-[var(--ff-text-secondary)] mb-4">
                            {attendees.length > 0
                                ? `Email invites have been sent to ${attendees.length} attendee(s).`
                                : 'Your meeting has been created.'}
                        </p>

                        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4 mb-4">
                            <p className="text-sm text-[var(--ff-text-secondary)] mb-2">Meeting Link:</p>
                            <a
                                href={success.meetingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline break-all"
                            >
                                {success.meetingUrl}
                            </a>
                        </div>

                        <div className="flex flex-wrap gap-2 justify-center mb-6">
                            <a
                                href={success.calendarLinks.googleCalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 text-sm"
                            >
                                📅 Add to Google Calendar
                            </a>
                            <a
                                href={success.calendarLinks.outlookUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 text-sm"
                            >
                                📧 Add to Outlook
                            </a>
                        </div>

                        <button
                            onClick={handleClose}
                            className="w-full py-3 bg-[var(--ff-text-primary)] text-[var(--ff-bg-primary)] rounded-lg hover:opacity-90"
                        >
                            Done
                        </button>
                    </div>
                ) : (
                    /* Form */
                    <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
                        <div className="p-6 space-y-5">
                            {/* Error */}
                            {error && (
                                <div className="flex items-center gap-2 px-4 py-3 bg-red-500/20 text-red-400 rounded-lg text-sm">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                    {error}
                                </div>
                            )}

                            {/* Title */}
                            <div>
                                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                                    Meeting Title *
                                </label>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="Weekly Team Standup"
                                    className="w-full px-4 py-2.5 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    required
                                />
                            </div>

                            {/* Description */}
                            <div>
                                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                                    Description (optional)
                                </label>
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Discuss project updates and blockers"
                                    rows={2}
                                    className="w-full px-4 py-2.5 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                                />
                            </div>

                            {/* Date & Time */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                                        <Calendar className="w-4 h-4 inline mr-1" />
                                        Date *
                                    </label>
                                    <input
                                        type="date"
                                        value={date}
                                        onChange={(e) => setDate(e.target.value)}
                                        min={new Date().toISOString().split('T')[0]}
                                        className="w-full px-4 py-2.5 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                                        <Clock className="w-4 h-4 inline mr-1" />
                                        Time *
                                    </label>
                                    <input
                                        type="time"
                                        value={time}
                                        onChange={(e) => setTime(e.target.value)}
                                        className="w-full px-4 py-2.5 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        required
                                    />
                                </div>
                            </div>

                            {/* Duration */}
                            <div>
                                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                                    Duration
                                </label>
                                <select
                                    value={duration}
                                    onChange={(e) => setDuration(Number(e.target.value))}
                                    className="w-full px-4 py-2.5 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                            <div>
                                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                                    <Users className="w-4 h-4 inline mr-1" />
                                    Invite Attendees
                                </label>

                                {/* Add attendee form */}
                                <div className="flex gap-2 mb-3">
                                    <input
                                        type="email"
                                        value={newEmail}
                                        onChange={(e) => setNewEmail(e.target.value)}
                                        placeholder="email@example.com"
                                        className="flex-1 px-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                                    />
                                    <input
                                        type="text"
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        placeholder="Name (optional)"
                                        className="w-32 px-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddAttendee}
                                        className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                </div>

                                {/* Attendees list */}
                                {attendees.length > 0 && (
                                    <div className="space-y-2">
                                        {attendees.map((attendee, index) => (
                                            <div
                                                key={index}
                                                className="flex items-center justify-between px-3 py-2 bg-[var(--ff-bg-tertiary)] rounded-lg"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Mail className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                                                    <span className="text-sm text-[var(--ff-text-primary)]">
                                                        {attendee.name ? `${attendee.name} (${attendee.email})` : attendee.email}
                                                    </span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveAttendee(index)}
                                                    className="p-1 text-[var(--ff-text-tertiary)] hover:text-red-500"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {attendees.length === 0 && (
                                    <p className="text-sm text-[var(--ff-text-secondary)] italic">
                                        No attendees added. You can schedule without inviting anyone.
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] flex gap-3">
                            <button
                                type="button"
                                onClick={handleClose}
                                className="flex-1 py-2.5 border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] rounded-lg hover:bg-[var(--ff-bg-hover)]"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Scheduling...
                                    </>
                                ) : (
                                    <>
                                        <Calendar className="w-4 h-4" />
                                        Schedule Meeting
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}

export default ScheduleMeetingModal;
