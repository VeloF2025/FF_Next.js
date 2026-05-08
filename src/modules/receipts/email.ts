/**
 * Receipt email notifications.
 *
 * Two flows:
 *   - sendReceiptSubmittedEmail: fired from /api/my/receipts/save right
 *     after a staff member submits a new receipt. Lets accounting know
 *     there's something to approve at /staff/receipts.
 *   - sendReceiptApprovedEmail: fired from /api/staff/receipts-review
 *     when a reviewer approves a receipt. Delivers the approved expense
 *     bundle to accounting in a single email.
 *
 * Both deliver the captured receipt photo as an attachment fetched from
 * VF Storage via resolveReceiptFetchUrl.
 *
 * Best-effort: SMTP failures are logged but never thrown — receipt
 * save / approve flows must not fail because email is flaky.
 */
import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { RECEIPT_CATEGORY_LABELS } from './categories';
import type { ReceiptRow } from './queries';
import { resolveReceiptFetchUrl } from './storage';

const RECEIPTS_INBOX = process.env.RECEIPTS_EMAIL_TO || 'receipts@velocityfibre.co.za';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app';

interface ReceiptContext {
  staffName: string;
  staffEmail: string | null;
  projectName: string | null;
  vehicleRegistration: string | null;
  reviewerName: string | null;
}

async function loadReceiptContext(receipt: ReceiptRow): Promise<ReceiptContext> {
  const rows = await sql<{
    staff_name: string | null;
    staff_email: string | null;
    project_name: string | null;
    vehicle_registration: string | null;
    reviewer_name: string | null;
  }>`
    SELECT
      TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS staff_name,
      s.email AS staff_email,
      p.project_name AS project_name,
      va.vehicle_registration AS vehicle_registration,
      TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS reviewer_name
    FROM staff_receipts r
    LEFT JOIN staff s ON s.id = r.staff_id
    LEFT JOIN projects p ON p.id = r.project_id
    LEFT JOIN vehicle_assignments va ON va.id = r.vehicle_assignment_id
    LEFT JOIN users u ON u.id = r.reviewed_by
    WHERE r.id = ${receipt.id}
    LIMIT 1
  `;
  const row = rows[0];
  return {
    staffName: row?.staff_name?.trim() || 'Unknown staff',
    staffEmail: row?.staff_email ?? null,
    projectName: row?.project_name ?? null,
    vehicleRegistration: row?.vehicle_registration ?? null,
    reviewerName: row?.reviewer_name?.trim() || null,
  };
}

function rands(cents: string | number | null | undefined, currency = 'ZAR'): string {
  if (cents === null || cents === undefined) return '';
  const value = typeof cents === 'string' ? Number(cents) : cents;
  if (!Number.isFinite(value)) return '';
  return `${currency} ${(value / 100).toFixed(2)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fileExtensionFromMime(mime: string | null | undefined): string {
  if (!mime) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('heic')) return 'heic';
  if (mime.includes('pdf')) return 'pdf';
  return 'jpg';
}

async function fetchReceiptImage(receipt: ReceiptRow): Promise<{ buffer: Buffer; filename: string } | null> {
  if (!receipt.image_url) return null;
  try {
    const url = resolveReceiptFetchUrl(receipt.image_url);
    const response = await fetch(url);
    if (!response.ok) {
      log.warn('[receipts/email] image fetch returned non-OK', {
        receiptId: receipt.id,
        status: response.status,
      });
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const ext = fileExtensionFromMime(receipt.image_mime);
    return {
      buffer: Buffer.from(arrayBuffer),
      filename: `receipt-${receipt.id}.${ext}`,
    };
  } catch (err) {
    log.warn('[receipts/email] image fetch failed', { err, receiptId: receipt.id });
    return null;
  }
}

interface MailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
}

async function sendMail(options: MailOptions): Promise<boolean> {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    log.warn('[receipts/email] SMTP not configured; skipping send', { to: options.to, subject: options.subject });
    return false;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodemailer = require(/* webpackIgnore: true */ 'nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false',
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments,
    });
    return true;
  } catch (err) {
    log.error('[receipts/email] sendMail failed', { err, to: options.to, subject: options.subject });
    return false;
  }
}

function detailRow(label: string, value: string | null | undefined): string {
  if (!value) return '';
  return `<tr><td style="padding:4px 12px 4px 0;color:#666;">${escapeHtml(label)}</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(value)}</td></tr>`;
}

function buildSummaryTable(receipt: ReceiptRow, ctx: ReceiptContext, includeReviewer: boolean): string {
  const total = rands(receipt.total_cents, receipt.currency);
  const vat = rands(receipt.vat_cents, receipt.currency);
  const categoryLabel = RECEIPT_CATEGORY_LABELS[receipt.category] ?? receipt.category;
  const paymentLabel = receipt.payment_method === 'company_card' ? 'Company card' : 'Personal reimbursement';

  return `
    <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
      ${detailRow('Staff', ctx.staffName)}
      ${detailRow('Date', receipt.receipt_date)}
      ${detailRow('Vendor', receipt.vendor)}
      ${detailRow('Total', total)}
      ${detailRow('VAT', vat)}
      ${detailRow('Category', categoryLabel)}
      ${detailRow('Payment', paymentLabel)}
      ${detailRow('Project', ctx.projectName)}
      ${detailRow('Vehicle', ctx.vehicleRegistration)}
      ${detailRow('Description', receipt.description)}
      ${includeReviewer ? detailRow('Approved by', ctx.reviewerName) : ''}
      ${includeReviewer && receipt.review_note ? detailRow('Reviewer note', receipt.review_note) : ''}
    </table>
  `;
}

function buildSummaryText(receipt: ReceiptRow, ctx: ReceiptContext, includeReviewer: boolean): string {
  const total = rands(receipt.total_cents, receipt.currency);
  const vat = rands(receipt.vat_cents, receipt.currency);
  const categoryLabel = RECEIPT_CATEGORY_LABELS[receipt.category] ?? receipt.category;
  const paymentLabel = receipt.payment_method === 'company_card' ? 'Company card' : 'Personal reimbursement';
  const lines = [
    `Staff: ${ctx.staffName}`,
    `Date: ${receipt.receipt_date}`,
    receipt.vendor ? `Vendor: ${receipt.vendor}` : null,
    `Total: ${total}`,
    vat ? `VAT: ${vat}` : null,
    `Category: ${categoryLabel}`,
    `Payment: ${paymentLabel}`,
    ctx.projectName ? `Project: ${ctx.projectName}` : null,
    ctx.vehicleRegistration ? `Vehicle: ${ctx.vehicleRegistration}` : null,
    receipt.description ? `Description: ${receipt.description}` : null,
    includeReviewer && ctx.reviewerName ? `Approved by: ${ctx.reviewerName}` : null,
    includeReviewer && receipt.review_note ? `Reviewer note: ${receipt.review_note}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

export async function sendReceiptSubmittedEmail(receipt: ReceiptRow): Promise<void> {
  try {
    const ctx = await loadReceiptContext(receipt);
    const image = await fetchReceiptImage(receipt);
    const reviewLink = `${APP_URL}/staff/receipts`;

    const subject = `Receipt to approve — ${ctx.staffName}, ${rands(receipt.total_cents, receipt.currency) || receipt.vendor || receipt.receipt_date}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:640px;color:#1a1a2e;">
        <h2 style="margin:0 0 12px 0;">New receipt awaiting approval</h2>
        <p style="margin:0 0 16px 0;">${escapeHtml(ctx.staffName)} submitted a receipt via the FibreFlow staff portal. The captured photo is attached.</p>
        ${buildSummaryTable(receipt, ctx, false)}
        <p style="margin:24px 0 0 0;">
          <a href="${reviewLink}" style="background:#3b82f6;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block;">Review in FibreFlow</a>
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="color:#999;font-size:12px;margin:0;">FibreFlow — Staff Receipts</p>
      </div>
    `;
    const text = `New receipt awaiting approval\n\n${buildSummaryText(receipt, ctx, false)}\n\nReview: ${reviewLink}`;

    await sendMail({
      to: RECEIPTS_INBOX,
      subject,
      html,
      text,
      attachments: image
        ? [{ filename: image.filename, content: image.buffer, contentType: receipt.image_mime || undefined }]
        : undefined,
    });
  } catch (err) {
    log.error('[receipts/email] sendReceiptSubmittedEmail failed', { err, receiptId: receipt.id });
  }
}

export async function sendReceiptApprovedEmail(receipt: ReceiptRow): Promise<void> {
  try {
    const ctx = await loadReceiptContext(receipt);
    const image = await fetchReceiptImage(receipt);

    const subject = `Receipt approved — ${ctx.staffName}, ${rands(receipt.total_cents, receipt.currency) || receipt.vendor || receipt.receipt_date}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:640px;color:#1a1a2e;">
        <h2 style="margin:0 0 12px 0;">Approved receipt</h2>
        <p style="margin:0 0 16px 0;">This receipt was approved in FibreFlow. The original photo is attached.</p>
        ${buildSummaryTable(receipt, ctx, true)}
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="color:#999;font-size:12px;margin:0;">FibreFlow — Staff Receipts</p>
      </div>
    `;
    const text = `Approved receipt\n\n${buildSummaryText(receipt, ctx, true)}`;

    await sendMail({
      to: RECEIPTS_INBOX,
      subject,
      html,
      text,
      attachments: image
        ? [{ filename: image.filename, content: image.buffer, contentType: receipt.image_mime || undefined }]
        : undefined,
    });
  } catch (err) {
    log.error('[receipts/email] sendReceiptApprovedEmail failed', { err, receiptId: receipt.id });
  }
}
