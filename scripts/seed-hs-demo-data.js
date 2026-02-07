/**
 * Seed H&S Demo Data
 * Seeds realistic demo data for Health & Safety module testing
 */

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

const sql = neon(DATABASE_URL);

async function seedHSData() {
  console.log('🌱 Starting H&S Demo Data Seed...\n');

  // Get existing data for FKs
  const projects = await sql`SELECT id, project_name FROM projects LIMIT 5`;
  const contractors = await sql`SELECT id, company_name, status FROM contractors WHERE status IN ('approved', 'pending') LIMIT 10`;

  console.log(`Found ${projects.length} projects, ${contractors.length} contractors\n`);

  if (projects.length === 0) {
    console.error('❌ No projects found. Cannot seed H&S data.');
    return;
  }

  // 1. Seed Checklist Templates
  console.log('📋 Seeding checklist templates...');

  const templates = await sql`
    INSERT INTO hs_checklist_templates (name, category, description, is_default, is_active) VALUES
    ('Working at Heights - Standard', 'working_at_heights', 'Fall protection and height work safety per Construction Reg 8', true, true),
    ('PPE Compliance - Standard', 'ppe', 'Personal protective equipment checks per OHS Act s8(2)(d)', true, true),
    ('Scaffolding Safety - SANS 10085', 'scaffolding', 'Scaffolding safety per SANS 10085 and Construction Reg 16', true, true),
    ('Electrical Safety - Standard', 'electrical', 'Electrical safety and lock-out/tag-out procedures', true, true),
    ('First Aid Readiness', 'first_aid', 'First aid equipment and personnel per General Safety Reg 3', true, true),
    ('Fire Safety - Standard', 'fire', 'Fire prevention and emergency equipment per Construction Reg 29', true, true),
    ('Fibre-Specific Safety', 'fibre_specific', 'Fibre optic installation specific hazards (glass, laser, chemicals)', true, true),
    ('Site Conditions - General', 'site_conditions', 'General site housekeeping and welfare per Construction Reg 24-26', true, true)
    ON CONFLICT DO NOTHING
    RETURNING id, category
  `;

  console.log(`  Created ${templates.length} templates`);

  // Get template IDs
  const allTemplates = await sql`SELECT id, category FROM hs_checklist_templates`;
  const templateMap = {};
  allTemplates.forEach(t => templateMap[t.category] = t.id);

  // 2. Seed Checklist Items
  console.log('📝 Seeding checklist items...');

  const checklistItems = [
    // Working at Heights
    { template: 'working_at_heights', text: 'Fall protection plan available and communicated to workers', severity: 'critical', ref: 'Construction Reg 8(1)', mandatory: true, photo: false },
    { template: 'working_at_heights', text: 'Full body harnesses inspected and in good condition', severity: 'critical', ref: 'Construction Reg 8(5)', mandatory: true, photo: true },
    { template: 'working_at_heights', text: 'Anchor points certified and load-tested', severity: 'critical', ref: 'Construction Reg 8(6)', mandatory: true, photo: false },
    { template: 'working_at_heights', text: 'Ladders secured and at correct angle (4:1 ratio)', severity: 'high', ref: 'Construction Reg 13', mandatory: true, photo: false },
    { template: 'working_at_heights', text: 'Guardrails installed where required (work >2m)', severity: 'critical', ref: 'Construction Reg 10', mandatory: true, photo: true },

    // PPE
    { template: 'ppe', text: 'Hard hats worn in designated areas', severity: 'high', ref: 'OHS Act s8(2)(d)', mandatory: true, photo: false },
    { template: 'ppe', text: 'Safety boots with steel toe caps worn by all workers', severity: 'high', ref: 'General Safety Reg 2', mandatory: true, photo: false },
    { template: 'ppe', text: 'Hi-visibility vests worn near traffic or vehicles', severity: 'high', ref: 'General Safety Reg 2', mandatory: true, photo: false },
    { template: 'ppe', text: 'Safety glasses available and used for fibre work', severity: 'high', ref: 'General Safety Reg 2', mandatory: true, photo: false },
    { template: 'ppe', text: 'Appropriate gloves provided for task', severity: 'medium', ref: 'General Safety Reg 2', mandatory: true, photo: false },

    // Fibre-Specific
    { template: 'fibre_specific', text: 'Fibre scraps disposed in sealed container', severity: 'high', ref: 'Best Practice', mandatory: true, photo: true },
    { template: 'fibre_specific', text: 'No eating or drinking in splicing area', severity: 'medium', ref: 'Best Practice', mandatory: true, photo: false },
    { template: 'fibre_specific', text: 'Laser safety glasses worn for OTDR work', severity: 'critical', ref: 'Best Practice', mandatory: true, photo: false },
    { template: 'fibre_specific', text: 'Warning signs for laser equipment displayed', severity: 'high', ref: 'Best Practice', mandatory: true, photo: true },
    { template: 'fibre_specific', text: 'Cleave waste container on-site and used', severity: 'medium', ref: 'Best Practice', mandatory: true, photo: true },

    // First Aid
    { template: 'first_aid', text: 'First aid kit stocked and accessible', severity: 'high', ref: 'General Safety Reg 3', mandatory: true, photo: true },
    { template: 'first_aid', text: 'Trained first aider present on site', severity: 'high', ref: 'General Safety Reg 3', mandatory: true, photo: false },
    { template: 'first_aid', text: 'Emergency contact numbers displayed', severity: 'medium', ref: 'General Safety Reg 3', mandatory: true, photo: true },
    { template: 'first_aid', text: 'Eye wash station available for fibre work', severity: 'high', ref: 'General Safety Reg 3', mandatory: true, photo: true },

    // Site Conditions
    { template: 'site_conditions', text: 'Site perimeter secured appropriately', severity: 'medium', ref: 'Construction Reg 24', mandatory: true, photo: false },
    { template: 'site_conditions', text: 'Adequate lighting for work areas', severity: 'medium', ref: 'Construction Reg 25', mandatory: true, photo: false },
    { template: 'site_conditions', text: 'Housekeeping maintained (no trip hazards)', severity: 'medium', ref: 'Construction Reg 26', mandatory: true, photo: true },
    { template: 'site_conditions', text: 'Welfare facilities adequate (toilets, water)', severity: 'medium', ref: 'Construction Reg 30', mandatory: true, photo: false },
    { template: 'site_conditions', text: 'Safety signage visible and current', severity: 'medium', ref: 'Construction Reg 24(b)', mandatory: true, photo: true },
  ];

  for (let i = 0; i < checklistItems.length; i++) {
    const item = checklistItems[i];
    const templateId = templateMap[item.template];
    if (templateId) {
      await sql`
        INSERT INTO hs_checklist_items (template_id, item_text, category, severity, regulation_reference, sort_order, is_mandatory, requires_photo)
        VALUES (${templateId}, ${item.text}, ${item.template}, ${item.severity}, ${item.ref}, ${i + 1}, ${item.mandatory}, ${item.photo})
        ON CONFLICT DO NOTHING
      `;
    }
  }
  console.log(`  Created ${checklistItems.length} checklist items`);

  // 3. Seed Contractor Compliance
  console.log('🏢 Seeding contractor compliance...');

  const complianceData = [
    { status: 'green', score: 92, safetyFile: 'verified', docsVerified: true },
    { status: 'amber', score: 68, safetyFile: 'pending', docsVerified: true },
    { status: 'red', score: 42, safetyFile: 'expired', docsVerified: false },
    { status: 'amber', score: 75, safetyFile: 'verified', docsVerified: true },
    { status: 'green', score: 88, safetyFile: 'verified', docsVerified: true },
  ];

  for (let i = 0; i < Math.min(contractors.length, complianceData.length); i++) {
    const c = contractors[i];
    const data = complianceData[i];

    // Check if exists
    const [existing] = await sql`SELECT id FROM hs_contractor_compliance WHERE contractor_id = ${c.id}`;
    if (existing) {
      await sql`
        UPDATE hs_contractor_compliance
        SET overall_score = ${data.score}, rag_status = ${data.status}, updated_at = NOW()
        WHERE contractor_id = ${c.id}
      `;
    } else {
      await sql`
        INSERT INTO hs_contractor_compliance (
          contractor_id, overall_score, rag_status, safety_file_status, documents_verified,
          last_audit_date, next_audit_due
        ) VALUES (
          ${c.id}, ${data.score}, ${data.status}, ${data.safetyFile}, ${data.docsVerified},
          ${new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()},
          ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()}
        )
      `;
    }
  }
  console.log(`  Created ${Math.min(contractors.length, complianceData.length)} contractor compliance records`);

  // 4. Seed Project Configs
  console.log('⚙️ Seeding project configs...');

  const ppeTemplateId = templateMap['ppe'];
  const fibreTemplateId = templateMap['fibre_specific'];

  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    const templateId = i % 2 === 0 ? ppeTemplateId : fibreTemplateId;
    const freq = ['weekly', 'fortnightly', 'monthly'][i % 3];
    const daysUntilAudit = [-5, 7, 14, 21, 30][i % 5]; // Some overdue, some upcoming

    // Check if exists
    const [existingConfig] = await sql`SELECT id FROM hs_project_config WHERE project_id = ${p.id}`;
    if (existingConfig) {
      await sql`
        UPDATE hs_project_config
        SET next_audit_due = ${new Date(Date.now() + daysUntilAudit * 24 * 60 * 60 * 1000).toISOString()},
            updated_at = NOW()
        WHERE project_id = ${p.id}
      `;
    } else {
      await sql`
        INSERT INTO hs_project_config (
          project_id, template_id, audit_frequency, next_audit_due, is_active
        ) VALUES (
          ${p.id}, ${templateId}, ${freq},
          ${new Date(Date.now() + daysUntilAudit * 24 * 60 * 60 * 1000).toISOString()},
          true
        )
      `;
    }
  }
  console.log(`  Created ${projects.length} project configs`);

  // 5. Seed Project Audits
  console.log('📊 Seeding project audits...');

  const auditData = [
    { score: 92, rag: 'green', status: 'completed' },
    { score: 75, rag: 'amber', status: 'completed' },
    { score: 45, rag: 'red', status: 'requires_action' },
    { score: 88, rag: 'green', status: 'completed' },
    { score: 68, rag: 'amber', status: 'completed' },
    { score: 95, rag: 'green', status: 'completed' },
    { score: null, rag: null, status: 'in_progress' },
  ];

  for (let i = 0; i < auditData.length; i++) {
    const a = auditData[i];
    const project = projects[i % projects.length];
    const daysAgo = i * 7;

    // Get config_id for this project
    const [config] = await sql`SELECT id FROM hs_project_config WHERE project_id = ${project.id}`;

    await sql`
      INSERT INTO hs_project_audits (
        project_id, config_id, audit_date, overall_score, rag_status,
        status, notes
      ) VALUES (
        ${project.id},
        ${config?.id || null},
        ${new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()},
        ${a.score}, ${a.rag}, ${a.status},
        ${a.status === 'requires_action' ? 'Several critical items failed. Corrective action required before work can continue.' : 'Routine audit completed successfully.'}
      )
    `;
  }
  console.log(`  Created ${auditData.length} project audits`);

  // 6. Seed Incidents (via maintenance_tickets + hs_ticket_details)
  console.log('🚨 Seeding H&S incidents...');

  const incidents = [
    { title: 'Minor cut from fibre glass', severity: 'minor', type: 'injury', dol: false },
    { title: 'Near miss - unsecured ladder', severity: 'moderate', type: 'near_miss', dol: false },
    { title: 'Vehicle damage at site entrance', severity: 'moderate', type: 'property_damage', dol: false },
    { title: 'Worker fall from height - hospitalized', severity: 'major', type: 'injury', dol: true },
    { title: 'Chemical spill in splicing area', severity: 'moderate', type: 'environmental', dol: false },
    { title: 'Near miss - power line contact', severity: 'critical', type: 'near_miss', dol: true },
  ];

  let incidentsCreated = 0;
  for (let i = 0; i < incidents.length; i++) {
    const inc = incidents[i];
    const project = projects[i % projects.length];
    const daysAgo = Math.floor(Math.random() * 60);
    const ticketUid = `HSE-2026-${String(i + 1).padStart(4, '0')}`;

    // Check if ticket already exists
    const [existing] = await sql`SELECT id FROM maintenance_tickets WHERE ticket_uid = ${ticketUid}`;
    if (existing) {
      continue; // Skip if already exists
    }

    // Create maintenance ticket - source=internal, type=incident
    const [ticket] = await sql`
      INSERT INTO maintenance_tickets (
        ticket_uid, source, source_type, title, description,
        priority, type, project_id, status, created_at, updated_at, created_by
      ) VALUES (
        ${ticketUid}, 'internal', 'hse_incident', ${inc.title},
        ${'H&S incident reported during site operations. ' + (inc.dol ? 'DOL reporting required.' : '')},
        ${inc.severity === 'critical' || inc.severity === 'major' ? 'critical' : inc.severity === 'moderate' ? 'high' : 'medium'},
        'incident',
        ${project.id},
        ${inc.severity === 'critical' ? 'open' : 'resolved'},
        ${new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()},
        NOW(),
        (SELECT id FROM users LIMIT 1)
      )
      RETURNING id
    `;

    // Add hs_ticket_details
    await sql`
      INSERT INTO hs_ticket_details (
        ticket_id, severity, dol_reportable, dol_reported, corrective_action_required, root_cause
      ) VALUES (
        ${ticket.id}, ${inc.severity}, ${inc.dol}, ${inc.dol && inc.severity !== 'critical'},
        ${inc.severity === 'major' || inc.severity === 'critical'},
        ${inc.type === 'injury' ? 'Inadequate PPE usage' : inc.type === 'near_miss' ? 'Procedural violation' : 'Environmental factors'}
      )
    `;
    incidentsCreated++;
  }
  console.log(`  Created ${incidentsCreated} H&S incidents (${incidents.length - incidentsCreated} already existed)`);

  // 7. Seed Activity Log
  console.log('📜 Seeding activity log...');

  const audits = await sql`SELECT id FROM hs_project_audits LIMIT 5`;
  const activities = [
    { activityType: 'audit_created', entityType: 'project_audit', desc: 'New audit created for project' },
    { activityType: 'audit_completed', entityType: 'project_audit', desc: 'Audit completed with score 92% (Green)' },
    { activityType: 'compliance_updated', entityType: 'contractor_compliance', desc: 'Contractor compliance score updated from 65% to 75%' },
    { activityType: 'config_created', entityType: 'project_config', desc: 'Project H&S configuration created with weekly audit schedule' },
    { activityType: 'incident_reported', entityType: 'ticket', desc: 'H&S incident reported: Major injury requiring DOL reporting' },
  ];

  for (let i = 0; i < activities.length; i++) {
    const act = activities[i];
    const entityId = audits[i % audits.length]?.id || projects[0].id;
    const daysAgo = i * 2;

    await sql`
      INSERT INTO hs_activity_log (activity_type, entity_type, entity_id, description, created_at)
      VALUES (${act.activityType}, ${act.entityType}, ${entityId}, ${act.desc},
        ${new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()})
    `;
  }
  console.log(`  Created ${activities.length} activity log entries`);

  console.log('\n✅ H&S Demo Data Seed Complete!');

  // Summary
  const summary = await sql`
    SELECT
      (SELECT COUNT(*) FROM hs_checklist_templates) as templates,
      (SELECT COUNT(*) FROM hs_checklist_items) as items,
      (SELECT COUNT(*) FROM hs_contractor_compliance) as compliance,
      (SELECT COUNT(*) FROM hs_project_config) as configs,
      (SELECT COUNT(*) FROM hs_project_audits) as audits,
      (SELECT COUNT(*) FROM hs_activity_log) as activities
  `;

  console.log('\n📈 Summary:');
  console.log(`  - Checklist Templates: ${summary[0].templates}`);
  console.log(`  - Checklist Items: ${summary[0].items}`);
  console.log(`  - Contractor Compliance: ${summary[0].compliance}`);
  console.log(`  - Project Configs: ${summary[0].configs}`);
  console.log(`  - Project Audits: ${summary[0].audits}`);
  console.log(`  - Activity Log: ${summary[0].activities}`);
}

seedHSData().catch(console.error);
