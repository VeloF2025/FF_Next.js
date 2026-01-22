interface Reminder {
  id: string;
  title: string;
  description?: string;
  due_date?: string;
  priority: 'low' | 'medium' | 'high';
  status: string;
}

interface RemindersByPriority {
  high: Reminder[];
  medium: Reminder[];
  low: Reminder[];
}

export function generateDailyReminderEmail(reminders: Reminder[]): string {
  // Group by priority
  const grouped: RemindersByPriority = {
    high: [],
    medium: [],
    low: []
  };

  reminders.forEach(r => {
    grouped[r.priority].push(r);
  });

  const priorityColors = {
    high: '#ef4444',    // red-500
    medium: '#f59e0b',  // amber-500
    low: '#3b82f6'      // blue-500
  };

  const priorityLabels = {
    high: 'High Priority',
    medium: 'Medium Priority',
    low: 'Low Priority'
  };

  let itemsHtml = '';

  // Render each priority group
  (['high', 'medium', 'low'] as const).forEach(priority => {
    if (grouped[priority].length > 0) {
      itemsHtml += `
        <div style="margin-bottom: 24px;">
          <h3 style="color: ${priorityColors[priority]}; font-size: 16px; font-weight: 600; margin-bottom: 12px;">
            ${priorityLabels[priority]} (${grouped[priority].length})
          </h3>
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${grouped[priority].map(r => `
              <li style="
                background: #f9fafb;
                border-left: 3px solid ${priorityColors[priority]};
                padding: 12px 16px;
                margin-bottom: 8px;
                border-radius: 4px;
              ">
                <div style="font-weight: 600; color: #111827; margin-bottom: 4px;">
                  ${escapeHtml(r.title)}
                </div>
                ${r.description ? `
                  <div style="color: #6b7280; font-size: 14px; margin-bottom: 4px;">
                    ${escapeHtml(r.description)}
                  </div>
                ` : ''}
                ${r.due_date ? `
                  <div style="color: #9ca3af; font-size: 12px;">
                    📅 Due: ${formatDate(r.due_date)}
                  </div>
                ` : ''}
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    }
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your Daily Reminders - FibreFlow</title>
    </head>
    <body style="
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: #f3f4f6;
    ">
      <div style="
        max-width: 600px;
        margin: 0 auto;
        padding: 40px 20px;
      ">
        <!-- Header -->
        <div style="
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          color: white;
          padding: 32px;
          border-radius: 8px 8px 0 0;
          text-align: center;
        ">
          <h1 style="margin: 0 0 8px 0; font-size: 28px;">
            Your Daily Reminders
          </h1>
          <p style="margin: 0; opacity: 0.9; font-size: 16px;">
            ${reminders.length} pending ${reminders.length === 1 ? 'task' : 'tasks'} for today
          </p>
        </div>

        <!-- Content -->
        <div style="
          background: white;
          padding: 32px;
          border-radius: 0 0 8px 8px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        ">
          ${itemsHtml}

          <!-- CTA Button -->
          <div style="text-align: center; margin-top: 32px;">
            <a href="https://www.fibreflow.app/settings/reminders" style="
              display: inline-block;
              background: #3b82f6;
              color: white;
              text-decoration: none;
              padding: 12px 32px;
              border-radius: 6px;
              font-weight: 600;
              font-size: 16px;
            ">
              Manage Reminders
            </a>
          </div>
        </div>

        <!-- Footer -->
        <div style="
          text-align: center;
          margin-top: 24px;
          color: #6b7280;
          font-size: 14px;
        ">
          <p style="margin: 0 0 8px 0;">
            You're receiving this because you have daily reminders enabled.
          </p>
          <p style="margin: 0;">
            <a href="https://www.fibreflow.app/settings/reminders" style="color: #3b82f6; text-decoration: none;">
              Update your reminder preferences
            </a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Reset hours for comparison
  date.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  tomorrow.setHours(0, 0, 0, 0);

  if (date.getTime() === today.getTime()) {
    return 'Today';
  } else if (date.getTime() === tomorrow.getTime()) {
    return 'Tomorrow';
  } else if (date < today) {
    return `Overdue (${date.toISOString().split('T')[0]})`;
  } else {
    return date.toISOString().split('T')[0];
  }
}
