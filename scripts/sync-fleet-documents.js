/**
 * Sync Fleet Documents from Odoo
 *
 * Syncs ir.attachment records for fleet.vehicle and fleet.vehicle.log.services
 * to FibreFlow fleet_vehicle_documents and fleet_service_logs tables.
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

  async getFleetAttachments() {
    // Get attachments for fleet vehicles and service logs
    const domain = [['res_model', 'in', ['fleet.vehicle', 'fleet.vehicle.log.services']]];

    return this.call('ir.attachment', 'search_read', [domain], {
      fields: [
        'id', 'name', 'res_model', 'res_id', 'mimetype', 'file_size',
        'create_date', 'write_date', 'type', 'description'
      ],
      limit: 200,
      order: 'create_date desc'
    });
  }
}

// Determine document type from filename
function getDocumentType(filename) {
  const name = (filename || '').toLowerCase();

  if (name.includes('license') || name.includes('licence')) return 'license';
  if (name.includes('registration') || name.includes('reg')) return 'registration';
  if (name.includes('insurance')) return 'insurance';
  if (name.includes('roadworthy') || name.includes('cof')) return 'roadworthy';
  if (name.includes('service') || name.includes('receipt')) return 'service_record';
  if (name.includes('invoice')) return 'invoice';
  if (name.includes('photo') || name.includes('image') || name.includes('img')) return 'photo';
  if (name.match(/\.(jpg|jpeg|png|gif|webp)$/i)) return 'photo';
  if (name.match(/\.(pdf)$/i)) return 'document';

  return 'other';
}

async function syncFleetDocuments() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         SYNC FLEET DOCUMENTS FROM ODOO                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const client = new OdooClient();
  await client.authenticate();
  console.log('✓ Connected to Odoo\n');

  const sql = neon(process.env.DATABASE_URL);

  // Get vehicle mapping (FF id by Odoo id)
  const vehicles = await sql`
    SELECT id, odoo_vehicle_id, registration FROM fleet_vehicles WHERE odoo_vehicle_id IS NOT NULL
  `;
  const vehicleMap = new Map(vehicles.map(v => [v.odoo_vehicle_id, { id: v.id, registration: v.registration }]));
  console.log(`Vehicle mapping: ${vehicleMap.size} vehicles\n`);

  // Get service log mapping (FF id by Odoo id)
  const services = await sql`
    SELECT id, odoo_service_id, vehicle_id FROM fleet_service_logs WHERE odoo_service_id IS NOT NULL
  `;
  const serviceMap = new Map(services.map(s => [s.odoo_service_id, { id: s.id, vehicleId: s.vehicle_id }]));
  console.log(`Service mapping: ${serviceMap.size} service logs\n`);

  // Get existing synced documents
  const existingDocs = await sql`
    SELECT odoo_attachment_id FROM fleet_vehicle_documents WHERE odoo_attachment_id IS NOT NULL
  `;
  const existingSet = new Set(existingDocs.map(d => d.odoo_attachment_id));
  console.log(`Already synced: ${existingSet.size} documents\n`);

  // Fetch fleet attachments from Odoo
  console.log('=== Fetching fleet attachments from Odoo ===');
  const attachments = await client.getFleetAttachments();
  console.log(`Found ${attachments.length} fleet attachments\n`);

  // Process attachments
  console.log('=== Syncing documents ===');
  let vehicleDocs = 0, serviceDocs = 0, orphaned = 0, updated = 0, errors = 0;
  const orphanedList = [];

  for (const att of attachments) {
    try {
      const isExisting = existingSet.has(att.id);
      const fileUrl = `https://velocityfibre.odoo.com/web/content/${att.id}?download=true`;
      const docType = getDocumentType(att.name);

      if (att.res_model === 'fleet.vehicle') {
        // Link to vehicle
        const vehicle = vehicleMap.get(att.res_id);

        if (!vehicle) {
          orphaned++;
          orphanedList.push({
            id: att.id,
            name: att.name,
            model: att.res_model,
            res_id: att.res_id,
            reason: 'Vehicle not found in FibreFlow'
          });
          continue;
        }

        if (isExisting) {
          await sql`
            UPDATE fleet_vehicle_documents SET
              document_name = ${att.name},
              document_type = ${docType},
              file_url = ${fileUrl},
              file_size = ${att.file_size || 0},
              mime_type = ${att.mimetype},
              description = ${att.description || null},
              updated_at = NOW()
            WHERE odoo_attachment_id = ${att.id}
          `;
          updated++;
        } else {
          await sql`
            INSERT INTO fleet_vehicle_documents (
              vehicle_id, odoo_attachment_id, document_type, document_name,
              file_url, file_size, mime_type, description,
              is_active, created_at
            ) VALUES (
              ${vehicle.id}, ${att.id}, ${docType}, ${att.name},
              ${fileUrl}, ${att.file_size || 0}, ${att.mimetype}, ${att.description || null},
              true, NOW()
            )
          `;
          vehicleDocs++;
          console.log(`  Added: ${att.name} → ${vehicle.registration}`);
        }

      } else if (att.res_model === 'fleet.vehicle.log.services') {
        // Link to service log
        const service = serviceMap.get(att.res_id);

        if (!service) {
          orphaned++;
          orphanedList.push({
            id: att.id,
            name: att.name,
            model: att.res_model,
            res_id: att.res_id,
            reason: 'Service log not found in FibreFlow'
          });
          continue;
        }

        // Update service log with attachment URL
        await sql`
          UPDATE fleet_service_logs SET
            attachment_url = ${fileUrl},
            updated_at = NOW()
          WHERE odoo_service_id = ${att.res_id}
        `;
        serviceDocs++;

        // Also add to vehicle documents for the vehicle
        if (!isExisting) {
          await sql`
            INSERT INTO fleet_vehicle_documents (
              vehicle_id, odoo_attachment_id, document_type, document_name,
              file_url, file_size, mime_type, description,
              is_active, created_at
            ) VALUES (
              ${service.vehicleId}, ${att.id}, 'service_record', ${att.name},
              ${fileUrl}, ${att.file_size || 0}, ${att.mimetype}, ${'Service record attachment'},
              true, NOW()
            )
            ON CONFLICT (odoo_attachment_id) DO NOTHING
          `;
        }
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
      COUNT(*) FILTER (WHERE document_type = 'photo') as photos,
      COUNT(*) FILTER (WHERE document_type = 'service_record') as service_records,
      COUNT(*) FILTER (WHERE document_type IN ('license', 'registration', 'insurance')) as legal_docs,
      SUM(file_size) as total_size
    FROM fleet_vehicle_documents
  `;

  const s = finalStats[0];
  console.log(`Total Fleet Documents: ${s.total}`);
  console.log(`  Photos: ${s.photos}`);
  console.log(`  Service Records: ${s.service_records}`);
  console.log(`  Legal Documents: ${s.legal_docs}`);
  console.log(`Total Size: ${(Number(s.total_size || 0) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`\nVehicle Docs: ${vehicleDocs}, Service Docs: ${serviceDocs}, Updated: ${updated}, Errors: ${errors}`);

  // Report orphaned documents
  if (orphanedList.length > 0) {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                    ORPHANED DOCUMENTS');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Found ${orphanedList.length} documents without a link:\n`);

    for (const doc of orphanedList) {
      console.log(`  [${doc.id}] ${doc.name}`);
      console.log(`       Model: ${doc.model}, Odoo ID: ${doc.res_id}`);
      console.log(`       Reason: ${doc.reason}\n`);
    }
  }
}

syncFleetDocuments().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
