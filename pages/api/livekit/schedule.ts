// Meeting Scheduling API
// Create, list, update scheduled meetings with email invites

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { neon } from '@neondatabase/serverless';
import { Resend } from 'resend';
import { v4 as uuidv4 } from 'uuid';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);
const resend = new Resend(process.env.RESEND_API_KEY);

interface Attendee {
    email: string;
    name?: string;
    status?: 'pending' | 'accepted' | 'declined';
}

interface ScheduleMeetingRequest {
    title: string;
    description?: string;
    scheduledAt: string; // ISO date string
    durationMinutes?: number;
    attendees?: Attendee[];
}

// Generate calendar links
function generateCalendarLinks(meeting: {
    title: string;
    description?: string;
    scheduledAt: string;
    durationMinutes: number;
    meetingUrl: string;
}) {
    const startDate = new Date(meeting.scheduledAt);
    const endDate = new Date(startDate.getTime() + meeting.durationMinutes * 60000);

    // Format for Google Calendar
    const googleStart = startDate.toISOString().replace(/-|:|\.\d{3}/g, '');
    const googleEnd = endDate.toISOString().replace(/-|:|\.\d{3}/g, '');
    const googleCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(meeting.title)}&dates=${googleStart}/${googleEnd}&details=${encodeURIComponent((meeting.description || '') + '\n\nJoin meeting: ' + meeting.meetingUrl)}&location=${encodeURIComponent(meeting.meetingUrl)}`;

    // Format for Outlook
    const outlookStart = startDate.toISOString();
    const outlookEnd = endDate.toISOString();
    const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${encodeURIComponent(meeting.title)}&startdt=${outlookStart}&enddt=${outlookEnd}&body=${encodeURIComponent((meeting.description || '') + '\n\nJoin meeting: ' + meeting.meetingUrl)}&location=${encodeURIComponent(meeting.meetingUrl)}`;

    // ICS file content
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//FibreFlow//Meeting//EN
BEGIN:VEVENT
UID:${uuidv4()}@fibreflow.app
DTSTAMP:${new Date().toISOString().replace(/-|:|\.\d{3}/g, '')}
DTSTART:${googleStart}
DTEND:${googleEnd}
SUMMARY:${meeting.title}
DESCRIPTION:${(meeting.description || '').replace(/\n/g, '\\n')}\\n\\nJoin meeting: ${meeting.meetingUrl}
LOCATION:${meeting.meetingUrl}
URL:${meeting.meetingUrl}
END:VEVENT
END:VCALENDAR`;

    return { googleCalUrl, outlookUrl, icsContent };
}

// Send email invite
async function sendMeetingInvite(
    attendee: Attendee,
    meeting: {
        title: string;
        description?: string;
        scheduledAt: string;
        durationMinutes: number;
        meetingUrl: string;
        roomName: string;
    }
) {
    const startDate = new Date(meeting.scheduledAt);
    const formattedDate = startDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
    const formattedTime = startDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
    });

    const calendarLinks = generateCalendarLinks(meeting);

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
        .content { background: #f8fafc; padding: 30px; border-radius: 0 0 12px 12px; }
        .meeting-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3B82F6; }
        .join-btn { display: inline-block; background: #3B82F6; color: white !important; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 20px 0; }
        .calendar-links { margin-top: 20px; }
        .calendar-links a { display: inline-block; margin-right: 15px; color: #3B82F6; text-decoration: none; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 style="margin:0;">📅 Meeting Invitation</h1>
            <p style="margin:10px 0 0 0; opacity: 0.9;">You've been invited to a FibreFlow meeting</p>
        </div>
        <div class="content">
            <h2 style="color: #1e293b; margin-top: 0;">${meeting.title}</h2>
            
            <div class="meeting-details">
                <p><strong>📆 Date:</strong> ${formattedDate}</p>
                <p><strong>🕐 Time:</strong> ${formattedTime}</p>
                <p><strong>⏱️ Duration:</strong> ${meeting.durationMinutes} minutes</p>
                ${meeting.description ? `<p><strong>📝 Description:</strong> ${meeting.description}</p>` : ''}
            </div>

            <div style="text-align: center;">
                <a href="${meeting.meetingUrl}" class="join-btn">Join Meeting</a>
            </div>

            <div class="calendar-links">
                <strong>Add to calendar:</strong><br/>
                <a href="${calendarLinks.googleCalUrl}" target="_blank">📅 Google Calendar</a>
                <a href="${calendarLinks.outlookUrl}" target="_blank">📧 Outlook</a>
            </div>

            <div class="footer">
                <p>This meeting was scheduled via FibreFlow</p>
                <p style="color: #999;">If you didn't expect this invitation, you can safely ignore this email.</p>
            </div>
        </div>
    </div>
</body>
</html>
`;

    try {
        await resend.emails.send({
            from: 'FibreFlow Meetings <notifications@fibreflow.app>',
            to: attendee.email,
            subject: `📅 Meeting Invitation: ${meeting.title}`,
            html: emailHtml,
        });
        return { success: true };
    } catch (error: any) {
        log.error('Failed to send email to attendee', { email: attendee.email, error });
        return { success: false, error: error.message };
    }
}

async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    // GET - List scheduled meetings
    if (req.method === 'GET') {
        try {
            const { upcoming } = req.query;

            let meetings;
            if (upcoming === 'true') {
                meetings = await sql`
                    SELECT id, room_name, title, description, scheduled_at, 
                           duration_minutes, attendees, status, meeting_url,
                           started_at, ended_at, created_at
                    FROM livekit_meetings
                    WHERE scheduled_at >= NOW() AND status IN ('scheduled', 'in_progress')
                    ORDER BY scheduled_at ASC
                `;
            } else {
                meetings = await sql`
                    SELECT id, room_name, title, description, scheduled_at, 
                           duration_minutes, attendees, status, meeting_url,
                           started_at, ended_at, created_at
                    FROM livekit_meetings
                    ORDER BY scheduled_at DESC
                `;
            }

            return res.status(200).json({ meetings });
        } catch (error: any) {
            log.error('Error listing meetings', { error });
            return res.status(500).json({ error: error.message });
        }
    }

    // POST - Schedule a new meeting
    if (req.method === 'POST') {
        try {
            const { title, description, scheduledAt, durationMinutes = 60, attendees = [] } = req.body as ScheduleMeetingRequest;

            if (!title || !scheduledAt) {
                return apiResponse.badRequest(res, 'Title and scheduledAt are required');
            }

            // Generate room name
            const roomName = `ff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            const meetingUrl = `https://app.fibreflow.app/livekit/${roomName}`;

            // Insert meeting into database
            const result = await sql`
                INSERT INTO livekit_meetings (
                    room_name, title, description, scheduled_at, 
                    duration_minutes, attendees, status, meeting_url
                ) VALUES (
                    ${roomName}, ${title}, ${description || null}, ${scheduledAt},
                    ${durationMinutes}, ${JSON.stringify(attendees)}, 'scheduled', ${meetingUrl}
                )
                RETURNING *
            `;

            const meeting = result[0];

            // Send email invites to all attendees
            const emailResults = [];
            for (const attendee of attendees) {
                if (attendee.email) {
                    const result = await sendMeetingInvite(attendee, {
                        title,
                        description,
                        scheduledAt,
                        durationMinutes,
                        meetingUrl,
                        roomName,
                    });
                    emailResults.push({ email: attendee.email, ...result });
                }
            }

            // Generate calendar links for response
            const calendarLinks = generateCalendarLinks({
                title,
                description,
                scheduledAt,
                durationMinutes,
                meetingUrl,
            });

            return res.status(201).json({
                success: true,
                meeting,
                meetingUrl,
                emailResults,
                calendarLinks,
            });
        } catch (error: any) {
            log.error('Error scheduling meeting', { error });
            return res.status(500).json({ error: error.message });
        }
    }

    // DELETE - Cancel a meeting
    if (req.method === 'DELETE') {
        try {
            const { id } = req.query;

            if (!id) {
                return apiResponse.badRequest(res, 'Meeting ID is required');
            }

            await sql`
                UPDATE livekit_meetings 
                SET status = 'cancelled', updated_at = NOW()
                WHERE id = ${id as string}
            `;

            return res.status(200).json({ success: true });
        } catch (error: any) {
            log.error('Error cancelling meeting', { error });
            return res.status(500).json({ error: error.message });
        }
    }

    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST', 'DELETE']);
}

export default withAuth(sendMeetingInvite);
