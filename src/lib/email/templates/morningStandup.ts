/**
 * Morning Standup Email Template
 *
 * Per-user daily digest of outstanding tickets, grouped into:
 *   - My Tickets   (assigned_to === this user)
 *   - Team Tickets (assigned to a team this user belongs to, excluding their own)
 *
 * Each ticket row surfaces its source module + source sub-type so the recipient
 * knows where the work lives (e.g. "NOC · ad_hoc", "H&S · routine audit").
 *
 * Rendered from `scripts/cron/send-morning-standup.ts` — one email per user,
 * Mon-Fri at 08:00 SAST.
 */

export type StandupTicketSource = 'noc' | 'hs' | 'manco';

export interface StandupTicket {
  /** Short human ref to show in the email (e.g. FT406824, HS audit id tail, MA-123) */
  ref: string;
  /** What module this ticket came from */
  source: StandupTicketSource;
  /** Sub-type within the source (e.g. NOC source 'ad_hoc', HS audit_type 'routine') */
  sourceDetail?: string;
  /** Headline of the ticket */
  title: string;
  /** Current status label (already human-friendly) */
  status: string;
  /** Priority if known */
  priority?: 'low' | 'medium' | 'normal' | 'high' | 'critical';
  /** Optional deep link back into the app */
  url?: string;
  /** ISO date of creation — used to compute age */
  createdAt?: string;
}

export interface StandupEmailInput {
  /** Friendly greeting name (first name preferred, falls back to email local part) */
  recipientName: string;
  /** Tickets where the recipient is the direct assignee */
  myTickets: StandupTicket[];
  /** Tickets assigned to a team the recipient belongs to, excluding their own */
  teamTickets: StandupTicket[];
  /** Date label shown in the header, e.g. "Wednesday, 08 April 2026" */
  dateLabel: string;
  /** Base app URL for CTA buttons — no trailing slash */
  appUrl: string;
}

const SOURCE_LABELS: Record<StandupTicketSource, string> = {
  noc: 'NOC',
  hs: 'H&S',
  manco: 'ManCo',
};

const SOURCE_COLORS: Record<StandupTicketSource, string> = {
  noc: '#2563eb', // blue-600
  hs: '#dc2626', // red-600
  manco: '#7c3aed', // violet-600
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#b91c1c',
  high: '#ef4444',
  medium: '#f59e0b',
  normal: '#64748b',
  low: '#3b82f6',
};

export function generateMorningStandupEmail(input: StandupEmailInput): string {
  const { recipientName, myTickets, teamTickets, dateLabel, appUrl } = input;
  const totalMine = myTickets.length;
  const totalTeam = teamTickets.length;

  const headline =
    totalMine === 0
      ? `${totalTeam} team ticket${totalTeam === 1 ? '' : 's'} need attention today`
      : `You have ${totalMine} open ticket${totalMine === 1 ? '' : 's'}${
          totalTeam > 0 ? ` · ${totalTeam} on your team` : ''
        }`;

  const myBlock = renderSection('My Tickets', myTickets, totalMine, '#0f172a');
  const teamBlock =
    totalTeam > 0 ? renderSection('Team Tickets', teamTickets, totalTeam, '#475569') : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your Morning Standup - FibreFlow</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f1f5f9;color:#0f172a;">
  <div style="max-width:640px;margin:0 auto;padding:32px 16px;">

    <!-- Header with Velocity logo -->
    <div style="background:#0f172a;border-radius:10px 10px 0 0;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#1e293b 0%,#334155 100%);padding:24px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="130" valign="middle">
            <img src="${appUrl}/help-assets/velocity-logo.jpg" alt="Velocity Fibre" width="120" style="display:block;border-radius:10px;">
          </td>
          <td align="right" valign="middle" style="color:#fff;">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;opacity:0.5;">Morning Standup</div>
            <div style="font-size:18px;font-weight:700;color:#fff;margin-top:4px;">${escapeHtml(dateLabel)}</div>
          </td>
        </tr></table>
      </div>
      <div style="padding:24px 32px 28px;color:#fff;">
        <h1 style="margin:0 0 8px 0;font-size:24px;font-weight:700;">Good morning, ${escapeHtml(recipientName)}</h1>
        <p style="margin:0;font-size:15px;opacity:0.8;line-height:1.5;">
          ${escapeHtml(headline)}. Here's what's on your plate and your team's today — so you can start the day knowing exactly where to focus.
        </p>
      </div>
    </div>

    <!-- Content -->
    <div style="background:#fff;padding:28px 32px;border-radius:0 0 10px 10px;box-shadow:0 2px 8px rgba(15,23,42,0.06);">
      ${myBlock}
      ${teamBlock}

      <div style="text-align:center;margin-top:28px;padding-top:24px;border-top:1px solid #e2e8f0;">
        <a href="${appUrl}/noc/tickets" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:14px;">
          Open FibreFlow
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;margin-top:20px;color:#64748b;font-size:12px;line-height:1.6;">
      <p style="margin:0;">You're receiving this because you have open tickets assigned to you in FibreFlow.</p>
      <p style="margin:4px 0 0 0;">Velocity Fibre · Morning Standup · Sent Mon–Fri at 08:00 SAST</p>
    </div>
  </div>
</body>
</html>`;
}

function renderSection(
  title: string,
  tickets: StandupTicket[],
  count: number,
  titleColor: string
): string {
  if (count === 0) {
    return `
      <div style="margin-bottom:24px;">
        <h2 style="color:${titleColor};font-size:16px;font-weight:700;margin:0 0 12px 0;text-transform:uppercase;letter-spacing:0.5px;">
          ${title} <span style="color:#94a3b8;font-weight:500;">(0)</span>
        </h2>
        <div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:6px;padding:16px;text-align:center;color:#64748b;font-size:14px;">
          Nothing open. Nice work.
        </div>
      </div>`;
  }

  // Order sensibly: by source, then by priority (high → low), then newest first
  const ordered = [...tickets].sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return priorityRank(b.priority) - priorityRank(a.priority);
  });

  const rows = ordered.map(renderTicketRow).join('');

  return `
    <div style="margin-bottom:28px;">
      <h2 style="color:${titleColor};font-size:16px;font-weight:700;margin:0 0 12px 0;text-transform:uppercase;letter-spacing:0.5px;">
        ${title} <span style="color:#94a3b8;font-weight:500;">(${count})</span>
      </h2>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
        ${rows}
      </table>
    </div>`;
}

function renderTicketRow(t: StandupTicket): string {
  const sourceColor = SOURCE_COLORS[t.source];
  const sourceLabel = SOURCE_LABELS[t.source];
  const sourceDetail = t.sourceDetail ? ` · ${escapeHtml(t.sourceDetail)}` : '';
  const priorityColor = t.priority ? PRIORITY_COLORS[t.priority] ?? '#64748b' : '#64748b';
  const priorityBadge = t.priority
    ? `<span style="display:inline-block;background:${priorityColor};color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(t.priority)}</span>`
    : '';
  const ageLabel = t.createdAt ? formatAge(t.createdAt) : '';
  const ageBadge = ageLabel
    ? `<span style="color:#94a3b8;font-size:12px;">${escapeHtml(ageLabel)}</span>`
    : '';
  const titleCell = t.url
    ? `<a href="${escapeHtml(t.url)}" style="color:#0f172a;text-decoration:none;font-weight:600;">${escapeHtml(t.title)}</a>`
    : `<span style="color:#0f172a;font-weight:600;">${escapeHtml(t.title)}</span>`;

  return `
    <tr>
      <td style="padding:10px 12px;border-left:3px solid ${sourceColor};background:#f8fafc;border-radius:4px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;">
          <div style="font-size:11px;font-weight:700;color:${sourceColor};text-transform:uppercase;letter-spacing:0.5px;">
            ${sourceLabel}${sourceDetail}
          </div>
          <div style="display:flex;gap:8px;align-items:center;">${priorityBadge}${ageBadge}</div>
        </div>
        <div style="font-size:14px;line-height:1.4;">${titleCell}</div>
        <div style="font-size:12px;color:#64748b;margin-top:3px;">
          <span style="font-family:monospace;">${escapeHtml(t.ref)}</span> · ${escapeHtml(t.status)}
        </div>
      </td>
    </tr>
    <tr><td style="height:8px;line-height:8px;">&nbsp;</td></tr>`;
}

function priorityRank(p?: string): number {
  switch (p) {
    case 'critical':
      return 5;
    case 'high':
      return 4;
    case 'medium':
      return 3;
    case 'normal':
      return 2;
    case 'low':
      return 1;
    default:
      return 0;
  }
}

function formatAge(iso: string): string {
  const created = new Date(iso).getTime();
  if (Number.isNaN(created)) return '';
  const days = Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'today';
  if (days === 1) return '1 day old';
  if (days < 30) return `${days} days old`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month old' : `${months} months old`;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return String(text).replace(/[&<>"']/g, (m) => map[m] ?? m);
}
