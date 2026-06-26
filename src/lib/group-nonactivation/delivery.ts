/**
 * Delivery for the group non-activation report: upload xlsx to VF Storage and
 * send to a WhatsApp group via the bridge. Reuses the proven OES report path
 * (VF Storage `/upload` → public URL → bridge `/send-document`).
 *
 * @module lib/group-nonactivation/delivery
 */
import { sendWhatsAppGroupDocument } from '@/modules/notifications/services/whatsappDelivery';
import type { GroupReportCounts } from './buildWorkbook';

const VF_STORAGE_BASE = process.env.VF_STORAGE_URL ?? 'http://100.96.203.105:8091';
const PUBLIC_STORAGE_BASE = 'https://app.fibreflow.app/storage';

/** Consolidated "Unresolved Pre-Provision" ops view target — the OES reconciliation hub. */
export const OPS_REVIEW_GROUP_JID =
  process.env.OPS_REVIEW_WA_GROUP_JID ?? '120363401065542642@g.us'; // Velocity - Activations

/** Upload an xlsx buffer to VF Storage and return its public URL (bridge-fetchable). */
export async function uploadReport(buffer: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([buffer as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  );
  const response = await fetch(`${VF_STORAGE_BASE}/upload/oes/reports`, { method: 'POST', body: form });
  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown');
    throw new Error(`VF Storage upload failed (${response.status}): ${text}`);
  }
  const result = (await response.json()) as { path?: string };
  return `${PUBLIC_STORAGE_BASE}/${result.path ?? `oes/reports/${filename}`}`;
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Per-group notice caption (signed as Jarvis). */
export function groupCaption(
  groupName: string,
  project: string | null,
  cohortDate: string,
  c: GroupReportCounts,
): string {
  const lines = [
    `*Activation Follow-up — ${groupName}${project ? ` (${project})` : ''}*`,
    `_Yesterday (${cohortDate}) — first submissions_`,
    '',
    `✅ Activated: ${c.activated} / ${c.cohort}`,
  ];
  if (c.miss > 0) {
    lines.push(`❌ Not activated: ${c.miss}${c.typos ? `  (⚠️ ${c.typos} look like typo'd DR numbers)` : ''}`);
  } else {
    lines.push('❌ Not activated: 0 — all clear 🎉');
  }
  if (c.pp > 0) {
    const nf = c.ppNotFound ? ` (${c.ppNotFound} not yet matched to a DR)` : '';
    lines.push(`⏳ Pre-provision serials added yesterday: ${c.pp}${nf} — see the *Pre-Provision* tab (by serial)`);
  }
  if (c.backlog > 0) {
    lines.push('', `📋 ${c.backlog} older drop(s) still not activated (carried over) — see the *Not Activated* tab.`);
  }
  if (c.miss > 0 || c.backlog > 0) {
    lines.push('', 'Please open the *Not Activated* tab and action / correct these DRs. Fix any wrong DR numbers and resubmit.');
  }
  lines.push('', '— Jarvis 🤖');
  return lines.join('\n');
}

/** Upload + send one group's workbook. Returns the storage URL. */
export async function sendGroupReport(
  groupJid: string,
  groupName: string,
  cohortDate: string,
  buffer: Buffer,
  caption: string,
): Promise<string> {
  const filename = `${safeName(groupName)}-NonActivation-${cohortDate}.xlsx`;
  const url = await uploadReport(buffer, filename);
  await sendWhatsAppGroupDocument(groupJid, url, filename, caption);
  return url;
}

/** Upload + send the consolidated ops workbook to the reconciliation hub. */
export async function sendOpsReport(
  generatedDate: string,
  totalNotFound: number,
  buffer: Buffer,
): Promise<string> {
  const filename = `Unresolved-PreProvision-${generatedDate}.xlsx`;
  const url = await uploadReport(buffer, filename);
  const caption =
    `*Unresolved Pre-Provision — reconciliation worklist*\n` +
    `_${generatedDate}_\n\n` +
    `${totalNotFound} ONT serial(s) on Fibertime's PP list not yet matched to a DR in our system.\n` +
    `Classified per row (in-stock / identifiable / field-sheet-flagged / unknown) with a likely DR where we have one.\n\n` +
    `— Jarvis 🤖`;
  await sendWhatsAppGroupDocument(OPS_REVIEW_GROUP_JID, url, filename, caption);
  return url;
}
