import type { NextApiRequest, NextApiResponse } from 'next';
import nodemailer from 'nodemailer';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql, logCreate } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const smtpTransport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// Temporary RFQ notification recipients until supplier emails are wired
const RFQ_NOTIFY_EMAILS = [
  'lizelle@velocityfibre.co.za',
  'jacques@velocityfibre.co.za',
  'hein@velocityfibre.co.za',
];

const sql = createLoggedSql(process.env.DATABASE_URL!);

/**
 * POST /api/procurement/requisitions/[id]/create-rfq
 * Creates an RFQ from a requisition, copying over the items
 */
export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const { id: requisitionId } = req.query;
  const { supplierIds, responseDeadline, createdBy } = req.body;

  if (!requisitionId || typeof requisitionId !== 'string') {
    return apiResponse.validationError(res, { requisitionId: 'Requisition ID is required' });
  }

  try {
    // Get requisition details
    const requisitions = await sql`
      SELECT * FROM purchase_requisitions WHERE id = ${requisitionId}
    `;

    if (requisitions.length === 0) {
      return apiResponse.notFound(res, 'Requisition', requisitionId);
    }

    const requisition = requisitions[0];

    // Check if RFQ already exists for this requisition
    const existingRfq = await sql`
      SELECT id, rfq_number FROM rfqs WHERE requisition_id = ${requisitionId}
    `;

    if (existingRfq.length > 0) {
      // Return existing RFQ instead of erroring — allows wizard to recover
      const existing = existingRfq[0];
      return apiResponse.success(res, {
        id: existing.id as string,
        rfqNumber: existing.rfq_number as string,
        alreadyExists: true,
      }, 'RFQ already exists for this requisition');
    }

    // Get requisition items
    const reqItems = await sql`
      SELECT * FROM purchase_requisition_items WHERE requisition_id = ${requisitionId}
    `;

    // Generate RFQ number
    const rfqNumber = `RFQ-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
    const deadline = responseDeadline || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    // Calculate total budget from requisition items
    const totalBudget = reqItems.reduce((sum: number, item: any) => {
      return sum + (Number(item.estimated_unit_price || 0) * Number(item.quantity || 0));
    }, 0);

    // Create the RFQ linked to requisition
    const insertedRfqs = await sql`
      INSERT INTO rfqs (
        rfq_number, project_id, requisition_id, title, description, status,
        response_deadline, total_budget_estimate, created_by
      )
      VALUES (
        ${rfqNumber},
        ${requisition.project_id},
        ${requisitionId},
        ${`RFQ for ${requisition.requisition_number}`},
        ${requisition.notes || `Request for quotes based on requisition ${requisition.requisition_number}`},
        'draft',
        ${deadline},
        ${totalBudget},
        ${createdBy || requisition.requested_by || 'System'}
      )
      RETURNING *
    `;

    const rfq = insertedRfqs[0];
    const rfqId = rfq.id;

    // Copy requisition items to RFQ items
    for (let i = 0; i < reqItems.length; i++) {
      const item = reqItems[i];
      await sql`
        INSERT INTO rfq_items (
          rfq_id, project_id, line_number, description, quantity, uom,
          specifications, budget_price, stock_item_id
        ) VALUES (
          ${rfqId},
          ${requisition.project_id},
          ${i + 1},
          ${item.description},
          ${item.quantity},
          ${item.uom || 'EA'},
          ${item.specifications || null},
          ${item.estimated_unit_price || 0},
          ${item.stock_item_id || null}
        )
      `;
    }

    // Add suppliers if provided
    const addedSuppliers: any[] = [];
    if (supplierIds && Array.isArray(supplierIds)) {
      for (const supplierId of supplierIds) {
        try {
          const result = await sql`
            INSERT INTO rfq_suppliers (rfq_id, supplier_id, status)
            VALUES (${rfqId}, ${parseInt(supplierId)}, 'invited')
            ON CONFLICT (rfq_id, supplier_id) DO NOTHING
            RETURNING *
          `;
          if (result[0]) {
            addedSuppliers.push(result[0]);
          }
        } catch (e) {
          log.error('CreateRfqApi', 'Failed to add supplier', { error: e });
          // Skip invalid supplier IDs
        }
      }
    }

    // Update requisition status to show RFQ was created
    await sql`
      UPDATE purchase_requisitions
      SET status = 'rfq_created', updated_at = NOW()
      WHERE id = ${requisitionId}
    `;

    // Send RFQ email notification
    const projectName = await getProjectName(requisition.project_id);
    void sendRfqEmail({
      rfqNumber,
      requisitionNumber: requisition.requisition_number as string,
      projectName,
      deadline,
      items: reqItems.map((item: Record<string, unknown>) => ({
        description: item.description as string,
        quantity: Number(item.quantity),
        uom: (item.uom as string) || 'EA',
        specifications: (item.specifications as string) || '',
      })),
    }).catch((err) => {
      log.error('CreateRfqApi', 'Failed to send RFQ email', { error: err });
    });

    // Log creation
    logCreate('rfq', rfqId, {
      rfq_number: rfq.rfq_number,
      requisition_id: requisitionId,
      requisition_number: requisition.requisition_number,
      items_count: reqItems.length,
      suppliers_count: addedSuppliers.length
    });

    return apiResponse.created(res, {
      id: rfqId,
      rfqNumber: rfq.rfq_number,
      projectId: rfq.project_id,
      requisitionId: requisitionId,
      requisitionNumber: requisition.requisition_number,
      title: rfq.title,
      status: rfq.status,
      itemsCount: reqItems.length,
      suppliersCount: addedSuppliers.length,
      totalBudget: totalBudget
    }, 'RFQ created from requisition successfully');

  } catch (error: any) {
    log.error('CreateRfqApi', 'Failed to create RFQ from requisition', { error });
    return apiResponse.databaseError(res, error, 'Failed to create RFQ from requisition');
  }
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getProjectName(projectId: string | null): Promise<string> {
  if (!projectId) return 'Unassigned';
  const rows = await sql`SELECT project_name FROM projects WHERE id = ${projectId}`;
  return (rows[0]?.project_name as string) || 'Unassigned';
}

interface RfqEmailData {
  rfqNumber: string;
  requisitionNumber: string;
  projectName: string;
  deadline: string;
  items: { description: string; quantity: number; uom: string; specifications: string }[];
}

async function sendRfqEmail(data: RfqEmailData): Promise<void> {
  const deadlineDate = new Date(data.deadline).toLocaleDateString('en-ZA', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  const itemRows = data.items
    .map(
      (item, i) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${i + 1}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.description)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.uom)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.specifications)}</td>
        </tr>`
    )
    .join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;color:#1f2937;">
      <div style="background:#4f46e5;padding:24px 32px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:22px;">Request for Quotation</h1>
        <p style="color:#c7d2fe;margin:6px 0 0;font-size:14px;">FibreFlow Procurement</p>
      </div>
      <div style="background:#fff;padding:24px 32px;border:1px solid #e5e7eb;border-top:none;">
        <p style="font-size:15px;line-height:1.6;">
          You are invited to submit a quotation for the following items:
        </p>
        <table style="width:100%;margin:16px 0;font-size:14px;">
          <tr style="background:#f3f4f6;">
            <td style="padding:8px 12px;font-weight:bold;">RFQ Number</td>
            <td style="padding:8px 12px;">${escapeHtml(data.rfqNumber)}</td>
            <td style="padding:8px 12px;font-weight:bold;">Requisition</td>
            <td style="padding:8px 12px;">${escapeHtml(data.requisitionNumber)}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;font-weight:bold;">Project</td>
            <td style="padding:8px 12px;">${escapeHtml(data.projectName)}</td>
            <td style="padding:8px 12px;font-weight:bold;">Response Due</td>
            <td style="padding:8px 12px;color:#dc2626;font-weight:600;">${deadlineDate}</td>
          </tr>
        </table>

        <h2 style="font-size:16px;margin:24px 0 12px;color:#374151;">Items to Quote</h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #d1d5db;">#</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #d1d5db;">Description</th>
              <th style="padding:8px 12px;text-align:center;border-bottom:2px solid #d1d5db;">Qty</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #d1d5db;">UOM</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #d1d5db;">Specifications</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
        </table>

        <div style="margin-top:24px;padding:16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;">
          <p style="margin:0;font-size:14px;color:#1e40af;">
            Please submit your quotation by <strong>${deadlineDate}</strong>.
            Reply to this email or contact the procurement team with any questions.
          </p>
        </div>
      </div>
      <div style="padding:16px 32px;background:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <p style="margin:0;font-size:12px;color:#6b7280;">
          This is an automated notification from FibreFlow Procurement.
          Prices are intentionally excluded — please provide your best quote.
        </p>
      </div>
    </div>
  `;

  const info = await smtpTransport.sendMail({
    from: `"Velocity Fibre Procurement" <${process.env.SMTP_FROM || 'procurement@velocityfibre.co.za'}>`,
    to: RFQ_NOTIFY_EMAILS.join(', '),
    subject: `RFQ ${data.rfqNumber} — ${data.projectName} — Please Quote`,
    html,
  });

  log.info('CreateRfqApi', 'RFQ email sent via SMTP', {
    rfqNumber: data.rfqNumber,
    messageId: info.messageId,
    recipients: RFQ_NOTIFY_EMAILS,
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
