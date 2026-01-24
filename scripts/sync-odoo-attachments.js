/**
 * Sync Attachments/Documents from Odoo
 *
 * Syncs ir.attachment records from Odoo to FibreFlow odoo_documents table.
 * Links documents to their parent entities (POs, GRNs, Invoices, etc.)
 */

const { neon } = require('@neondatabase/serverless');

class OdooClient {
  constructor() {
    this.url = 'https://velocityfibre.odoo.com';
    this.db = 'velocityfibre';
    this.username = 'jacques@velocityfibre.co.za';
    this.password = 'Ledene9685@';
    this.uid = null;
  }

  async authenticate() {
    const response = await fetch(`${this.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service: 'common', method: 'authenticate', args: [this.db, this.username, this.password, {}] },
        id: 1
      })
    });
    const data = await response.json();
    this.uid = data.result;
    if (!this.uid) throw new Error('Authentication failed');
    return this.uid;
  }

  async call(model, method, args, kwargs = {}) {
    const response = await fetch(`${this.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service: 'object', method: 'execute_kw', args: [this.db, this.uid, this.password, model, method, args, kwargs] },
        id: Date.now()
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.data?.message || data.error.message);
    return data.result;
  }

  async getAttachments(options = {}) {
    // Focus on procurement-related models
    const procurementModels = [
      'purchase.order',
      'stock.picking',
      'account.move',
      'product.product',
      'product.template',
      'res.partner'
    ];

    const domain = [['res_model', 'in', procurementModels]];

    return this.call('ir.attachment', 'search_read', [domain], {
      fields: [
        'id', 'name', 'res_model', 'res_id', 'mimetype', 'file_size',
        'create_date', 'write_date', 'type', 'description', 'checksum'
      ],
      limit: options.limit || 1000,
      order: 'create_date desc'
    });
  }
}

// Map Odoo model to FibreFlow entity type
function mapModelToEntityType(odooModel) {
  const mapping = {
    'purchase.order': 'purchase_order',
    'stock.picking': 'goods_receipt_note',
    'account.move': 'vendor_invoice',
    'product.product': 'stock_item',
    'product.template': 'stock_item',
    'res.partner': 'supplier'
  };
  return mapping[odooModel] || odooModel;
}

// Determine document type from filename/mimetype
function determineDocumentType(filename, mimetype) {
  const name = (filename || '').toLowerCase();
  const mime = (mimetype || '').toLowerCase();

  if (name.includes('invoice') || name.includes('bill')) return 'invoice';
  if (name.includes('delivery') || name.includes('grn')) return 'delivery_note';
  if (name.includes('po') || name.includes('order')) return 'purchase_order';
  if (name.includes('quote') || name.includes('quotation')) return 'quotation';
  if (name.includes('contract')) return 'contract';
  if (name.includes('spec') || name.includes('datasheet')) return 'specification';
  if (mime.includes('pdf')) return 'pdf_document';
  if (mime.includes('image')) return 'image';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'spreadsheet';
  return 'other';
}

async function syncAttachments() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         SYNC ATTACHMENTS FROM ODOO                           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const client = new OdooClient();
  await client.authenticate();
  console.log('✓ Connected to Odoo\n');

  const sql = neon(process.env.DATABASE_URL);

  // Build entity mappings
  console.log('Building entity mappings...');

  const poMap = new Map();
  const pos = await sql`SELECT id, odoo_po_id FROM purchase_orders WHERE odoo_po_id IS NOT NULL`;
  pos.forEach(p => poMap.set(p.odoo_po_id, p.id));

  const grnMap = new Map();
  const grns = await sql`SELECT id, odoo_picking_id FROM goods_receipt_notes WHERE odoo_picking_id IS NOT NULL`;
  grns.forEach(g => grnMap.set(g.odoo_picking_id, g.id));

  const invoiceMap = new Map();
  const invoices = await sql`SELECT id, odoo_move_id FROM vendor_invoices WHERE odoo_move_id IS NOT NULL`;
  invoices.forEach(i => invoiceMap.set(i.odoo_move_id, i.id));

  const productMap = new Map();
  const products = await sql`SELECT id, odoo_product_id FROM stock_items WHERE odoo_product_id IS NOT NULL`;
  products.forEach(p => productMap.set(p.odoo_product_id, p.id));

  const supplierMap = new Map();
  const suppliers = await sql`SELECT id, odoo_partner_id FROM suppliers WHERE odoo_partner_id IS NOT NULL`;
  suppliers.forEach(s => supplierMap.set(s.odoo_partner_id, s.id));

  console.log(`  POs: ${poMap.size}, GRNs: ${grnMap.size}, Invoices: ${invoiceMap.size}`);
  console.log(`  Products: ${productMap.size}, Suppliers: ${supplierMap.size}\n`);

  // Get existing synced attachments
  const existingAttachments = await sql`
    SELECT odoo_attachment_id FROM odoo_documents WHERE odoo_attachment_id IS NOT NULL
  `;
  const existingSet = new Set(existingAttachments.map(a => a.odoo_attachment_id));
  console.log(`Already synced: ${existingSet.size} attachments\n`);

  // Fetch attachments from Odoo
  console.log('=== Fetching attachments from Odoo ===');
  const attachments = await client.getAttachments({ limit: 1000 });
  console.log(`Found ${attachments.length} attachments\n`);

  // Group by model for stats
  const byModel = {};
  for (const a of attachments) {
    byModel[a.res_model] = (byModel[a.res_model] || 0) + 1;
  }
  console.log('By model:');
  Object.entries(byModel).forEach(([m, c]) => console.log(`  ${m}: ${c}`));
  console.log('');

  // Process attachments
  console.log('=== Syncing attachments ===');
  let created = 0, updated = 0, skipped = 0, errors = 0;

  for (const att of attachments) {
    try {
      const isExisting = existingSet.has(att.id);

      // Map to FibreFlow entity
      const entityType = mapModelToEntityType(att.res_model);
      let entityId = null;

      switch (att.res_model) {
        case 'purchase.order':
          entityId = poMap.get(att.res_id);
          break;
        case 'stock.picking':
          entityId = grnMap.get(att.res_id);
          break;
        case 'account.move':
          entityId = invoiceMap.get(att.res_id);
          break;
        case 'product.product':
        case 'product.template':
          entityId = productMap.get(att.res_id);
          break;
        case 'res.partner':
          entityId = supplierMap.get(att.res_id);
          break;
      }

      // Skip if we can't link to an entity
      if (!entityId) {
        skipped++;
        continue;
      }

      const documentType = determineDocumentType(att.name, att.mimetype);

      if (isExisting) {
        // Update existing
        await sql`
          UPDATE odoo_documents SET
            document_name = ${att.name},
            file_name = ${att.name},
            file_size = ${att.file_size || 0},
            mime_type = ${att.mimetype},
            document_type = ${documentType},
            description = ${att.description || null},
            file_hash = ${att.checksum || null},
            odoo_write_date = ${att.write_date ? new Date(att.write_date) : null},
            ff_entity_id = ${entityId},
            sync_status = 'pending',
            updated_at = NOW()
          WHERE odoo_attachment_id = ${att.id}
        `;
        updated++;
      } else {
        // Insert new - file_path/url point to Odoo for now (actual download can happen later)
        const filePath = `odoo://attachments/${att.id}/${encodeURIComponent(att.name)}`;
        const fileUrl = `https://velocityfibre.odoo.com/web/content/${att.id}?download=true`;

        await sql`
          INSERT INTO odoo_documents (
            odoo_attachment_id, odoo_model, odoo_record_id, odoo_write_date,
            ff_entity_type, ff_entity_id,
            document_type, document_name, description,
            file_name, file_path, file_url, file_size, mime_type, file_hash,
            sync_status, created_at
          ) VALUES (
            ${att.id}, ${att.res_model}, ${att.res_id},
            ${att.write_date ? new Date(att.write_date) : null},
            ${entityType}, ${entityId},
            ${documentType}, ${att.name}, ${att.description || null},
            ${att.name}, ${filePath}, ${fileUrl}, ${att.file_size || 0}, ${att.mimetype}, ${att.checksum || null},
            'pending', NOW()
          )
        `;
        created++;
      }

      // Progress
      if ((created + updated) % 50 === 0 && (created + updated) > 0) {
        console.log(`  Progress: ${created} created, ${updated} updated, ${skipped} skipped`);
      }

    } catch (e) {
      errors++;
      console.log(`  Error on ${att.name}: ${e.message.substring(0, 60)}`);
    }
  }

  // Final stats
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                         SYNC COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');

  const finalStats = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE ff_entity_type = 'purchase_order') as po_docs,
      COUNT(*) FILTER (WHERE ff_entity_type = 'goods_receipt_note') as grn_docs,
      COUNT(*) FILTER (WHERE ff_entity_type = 'vendor_invoice') as invoice_docs,
      COUNT(*) FILTER (WHERE ff_entity_type = 'stock_item') as product_docs,
      COUNT(*) FILTER (WHERE ff_entity_type = 'supplier') as supplier_docs,
      SUM(file_size) as total_size
    FROM odoo_documents
  `;

  const s = finalStats[0];
  console.log(`Total Documents: ${s.total}`);
  console.log(`  Purchase Orders: ${s.po_docs}`);
  console.log(`  GRNs: ${s.grn_docs}`);
  console.log(`  Invoices: ${s.invoice_docs}`);
  console.log(`  Products: ${s.product_docs}`);
  console.log(`  Suppliers: ${s.supplier_docs}`);
  console.log(`Total Size: ${(Number(s.total_size || 0) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`\nCreated: ${created}, Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
}

syncAttachments().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
