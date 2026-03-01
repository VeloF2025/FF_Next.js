/**
 * Daily WhatsApp Digest Generator
 *
 * Queries undigested field ops WA messages for a given date, generates
 * per-project markdown reports, and marks messages as digested.
 *
 * @module lib/wa-digest/generateDailyDigest
 */

import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import fs from 'fs';
import path from 'path';

const logger = createLogger('wa-digest');

export interface DigestOptions {
  date: string; // YYYY-MM-DD
  projectFilter?: string;
}

export interface DigestResult {
  projects: string[];
  messageCount: number;
  photoCount: number;
  files: string[];
}

interface WaMessageRow {
  id: string;
  wa_group_jid: string;
  group_type: string;
  sender_name: string | null;
  sender_jid: string;
  message_text: string | null;
  message_timestamp: string;
  project: string | null;
  has_media: boolean;
  media_type: string | null;
  media_count: number;
}

interface GroupSummary {
  project: string;
  group_type: string;
  wa_group_jid: string;
  messages: WaMessageRow[];
  photoCount: number;
}

/**
 * Generates markdown daily digest files for all field ops groups that have
 * undigested messages on the target date.
 */
export async function generateDailyDigest(options: DigestOptions): Promise<DigestResult> {
  const sql = neon(process.env.DATABASE_URL!);
  const { date, projectFilter } = options;

  logger.info('Starting daily digest generation', { date, projectFilter });

  // Query all undigested messages for the target date
  // Use explicit query branches to avoid neon tagged template null-type issues
  const rawRows = projectFilter
    ? await sql`
        SELECT id, wa_group_jid, group_type, sender_name, sender_jid,
               message_text, message_timestamp, project, has_media, media_type, media_count
        FROM field_ops_wa_messages
        WHERE digest_date IS NULL
          AND message_timestamp::date = ${date}::date
          AND project = ${projectFilter}
        ORDER BY wa_group_jid, message_timestamp ASC
      `
    : await sql`
        SELECT id, wa_group_jid, group_type, sender_name, sender_jid,
               message_text, message_timestamp, project, has_media, media_type, media_count
        FROM field_ops_wa_messages
        WHERE digest_date IS NULL
          AND message_timestamp::date = ${date}::date
        ORDER BY wa_group_jid, message_timestamp ASC
      `;
  const rows = rawRows.map((r) => r as unknown as WaMessageRow);

  if (rows.length === 0) {
    logger.info('No undigested messages found for date', { date });
    return { projects: [], messageCount: 0, photoCount: 0, files: [] };
  }

  // Group messages by project + group_type
  const groupMap = new Map<string, GroupSummary>();
  for (const row of rows) {
    const project = row.project ?? 'Unknown';
    const key = `${project}__${row.group_type}__${row.wa_group_jid}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        project,
        group_type: row.group_type,
        wa_group_jid: row.wa_group_jid,
        messages: [],
        photoCount: 0,
      });
    }
    const group = groupMap.get(key)!;
    group.messages.push(row);
    if (row.has_media && row.media_type === 'image') {
      group.photoCount += row.media_count ?? 0;
    }
  }

  const generatedFiles: string[] = [];
  const processedIds: string[] = [];
  const projectsProcessed = new Set<string>();

  for (const group of groupMap.values()) {
    const { project, group_type, messages, photoCount } = group;
    projectsProcessed.add(project);

    const markdown = buildMarkdown(project, group_type, date, messages, photoCount);

    // Save to docs/wa-digests/{project}/{YYYY-MM-DD}-{group_type}.md
    const digestDir = path.join(
      process.cwd(),
      'docs',
      'wa-digests',
      project.toLowerCase().replace(/\s+/g, '-')
    );
    fs.mkdirSync(digestDir, { recursive: true });

    const filename = `${date}-${group_type}.md`;
    const filePath = path.join(digestDir, filename);
    fs.writeFileSync(filePath, markdown, 'utf-8');

    generatedFiles.push(filePath);
    logger.info('Digest file written', { filePath, messages: messages.length, photos: photoCount });

    for (const msg of messages) {
      processedIds.push(msg.id);
    }
  }

  // Mark all processed messages with digest_date
  if (processedIds.length > 0) {
    await sql`
      UPDATE field_ops_wa_messages
      SET digest_date = ${date}::date
      WHERE id = ANY(${processedIds}::uuid[])
    `;
    logger.info('Messages marked as digested', { count: processedIds.length, date });
  }

  const totalPhotoCount = Array.from(groupMap.values()).reduce(
    (sum, g) => sum + g.photoCount,
    0
  );

  return {
    projects: Array.from(projectsProcessed),
    messageCount: rows.length,
    photoCount: totalPhotoCount,
    files: generatedFiles,
  };
}

/**
 * Builds the markdown content for a single project + group_type digest.
 */
function buildMarkdown(
  project: string,
  groupType: string,
  date: string,
  messages: WaMessageRow[],
  photoCount: number
): string {
  const groupLabel = groupType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const lines: string[] = [];

  // Header
  lines.push(`# WhatsApp Field Report — ${project} ${groupLabel} — ${date}`);
  lines.push('');

  // Summary section
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Date**: ${date}`);
  lines.push(`- **Project**: ${project}`);
  lines.push(`- **Group type**: ${groupLabel}`);
  lines.push(`- **Total messages**: ${messages.length}`);
  lines.push(`- **Photos received**: ${photoCount}`);

  const senders = new Set(messages.map((m) => m.sender_name ?? m.sender_jid));
  lines.push(`- **Contributors**: ${Array.from(senders).join(', ')}`);
  lines.push('');

  // Timeline section
  lines.push('## Message Timeline');
  lines.push('');

  for (const msg of messages) {
    const time = new Date(msg.message_timestamp).toISOString().replace('T', ' ').slice(0, 19);
    const sender = msg.sender_name ?? msg.sender_jid;
    const text = msg.message_text ?? '';

    let entry = `**${time}** — *${sender}*`;
    if (text) {
      entry += `\n> ${text.replace(/\n/g, '\n> ')}`;
    }
    if (msg.has_media) {
      const mediaDesc =
        msg.media_type === 'image'
          ? `${msg.media_count ?? 1} photo(s)`
          : msg.media_type ?? 'media';
      entry += `\n> [${mediaDesc} attached]`;
    }
    lines.push(entry);
    lines.push('');
  }

  // Photos table section (only if there are photos)
  if (photoCount > 0) {
    lines.push('## Photos');
    lines.push('');
    lines.push('| Sender | Time | Count | VLM Status |');
    lines.push('|--------|------|-------|------------|');

    for (const msg of messages) {
      if (msg.has_media && msg.media_type === 'image') {
        const time = new Date(msg.message_timestamp).toISOString().slice(11, 19);
        const sender = msg.sender_name ?? msg.sender_jid;
        lines.push(`| ${sender} | ${time} | ${msg.media_count ?? 1} | pending |`);
      }
    }
    lines.push('');
  }

  // Issues flagged — keyword scan for common issue patterns
  const issueKeywords = ['down', 'fault', 'broken', 'issue', 'problem', 'fail', 'error', 'not working'];
  const flaggedMessages = messages.filter((m) => {
    if (!m.message_text) return false;
    const lower = m.message_text.toLowerCase();
    return issueKeywords.some((kw) => lower.includes(kw));
  });

  if (flaggedMessages.length > 0) {
    lines.push('## Issues Flagged');
    lines.push('');
    for (const msg of flaggedMessages) {
      const sender = msg.sender_name ?? msg.sender_jid;
      lines.push(`- **${sender}**: ${msg.message_text}`);
    }
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push(`*Generated by FibreFlow digest cron — ${new Date().toISOString()}*`);
  lines.push('');

  return lines.join('\n');
}
