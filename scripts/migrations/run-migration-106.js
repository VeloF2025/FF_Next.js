/**
 * Migration runner for 106_budget_templates.sql
 * Run with: node scripts/migrations/run-migration-106.js
 */

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

const sql = neon(DATABASE_URL);

async function runMigration() {
  console.log('Running migration 106_budget_templates.sql...\n');

  try {
    // Step 1: Create budget_templates table
    console.log('Creating budget_templates table...');
    await sql`
      CREATE TABLE IF NOT EXISTS budget_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        template_type VARCHAR(50) DEFAULT 'project',
        default_currency VARCHAR(3) DEFAULT 'ZAR',
        default_enforce_budget BOOLEAN DEFAULT true,
        default_allow_override BOOLEAN DEFAULT false,
        default_warning_threshold DECIMAL(5,2) DEFAULT 80.00,
        default_critical_threshold DECIMAL(5,2) DEFAULT 95.00,
        is_active BOOLEAN DEFAULT true,
        is_system BOOLEAN DEFAULT false,
        usage_count INTEGER DEFAULT 0,
        last_used_at TIMESTAMPTZ,
        created_by VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log('✓ budget_templates table created');

    // Step 2: Create budget_template_categories table
    console.log('Creating budget_template_categories table...');
    await sql`
      CREATE TABLE IF NOT EXISTS budget_template_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        template_id UUID NOT NULL REFERENCES budget_templates(id) ON DELETE CASCADE,
        category_code VARCHAR(50) NOT NULL,
        category_name VARCHAR(255) NOT NULL,
        description TEXT,
        default_percent DECIMAL(5,2),
        default_amount DECIMAL(15,2),
        sort_order INTEGER DEFAULT 0,
        color VARCHAR(20),
        icon VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(template_id, category_code)
      )
    `;
    console.log('✓ budget_template_categories table created');

    // Step 3: Add cost_center_id to budget tables
    console.log('Adding cost_center_id to budget_items...');
    try {
      await sql`ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id)`;
    } catch (e) {
      // Column might already exist
    }
    console.log('✓ cost_center_id added to budget_items');

    console.log('Adding cost_center_id to budget_categories...');
    try {
      await sql`ALTER TABLE budget_categories ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id)`;
    } catch (e) {
      // Column might already exist
    }
    console.log('✓ cost_center_id added to budget_categories');

    console.log('Adding cost_center_id to budget_transactions...');
    try {
      await sql`ALTER TABLE budget_transactions ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id)`;
    } catch (e) {
      // Column might already exist
    }
    console.log('✓ cost_center_id added to budget_transactions');

    // Step 4: Create indexes
    console.log('Creating indexes...');
    await sql`CREATE INDEX IF NOT EXISTS idx_budget_templates_active ON budget_templates(is_active) WHERE is_active = true`;
    await sql`CREATE INDEX IF NOT EXISTS idx_budget_templates_type ON budget_templates(template_type)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_budget_template_cats_template ON budget_template_categories(template_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_budget_items_cost_center ON budget_items(cost_center_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_budget_categories_cost_center ON budget_categories(cost_center_id)`;
    console.log('✓ Indexes created');

    // Step 5: Insert default templates
    console.log('Inserting Fiber Installation template...');
    await sql`
      INSERT INTO budget_templates (code, name, description, template_type, is_system) VALUES
        ('FIBER_INSTALL', 'Fiber Installation Project', 'Standard budget template for fiber installation projects', 'project', true)
      ON CONFLICT (code) DO NOTHING
    `;

    const fiberTemplate = await sql`SELECT id FROM budget_templates WHERE code = 'FIBER_INSTALL'`;
    if (fiberTemplate.length > 0) {
      const templateId = fiberTemplate[0].id;
      await sql`
        INSERT INTO budget_template_categories (template_id, category_code, category_name, default_percent, sort_order, color)
        VALUES
          (${templateId}, 'MATERIALS', 'Materials & Cable', 35.00, 1, '#3b82f6'),
          (${templateId}, 'EQUIPMENT', 'Equipment & Tools', 10.00, 2, '#8b5cf6'),
          (${templateId}, 'CIVIL', 'Civil Works', 20.00, 3, '#f59e0b'),
          (${templateId}, 'LABOR', 'Labor & Installation', 20.00, 4, '#22c55e'),
          (${templateId}, 'TRANSPORT', 'Transport & Logistics', 5.00, 5, '#06b6d4'),
          (${templateId}, 'OVERHEAD', 'Overhead & Admin', 5.00, 6, '#6b7280'),
          (${templateId}, 'CONTINGENCY', 'Contingency Reserve', 5.00, 7, '#ef4444')
        ON CONFLICT (template_id, category_code) DO NOTHING
      `;
    }
    console.log('✓ Fiber Installation template created');

    console.log('Inserting Maintenance template...');
    await sql`
      INSERT INTO budget_templates (code, name, description, template_type, is_system) VALUES
        ('MAINTENANCE', 'Maintenance Project', 'Budget template for network maintenance projects', 'project', true)
      ON CONFLICT (code) DO NOTHING
    `;

    const maintTemplate = await sql`SELECT id FROM budget_templates WHERE code = 'MAINTENANCE'`;
    if (maintTemplate.length > 0) {
      const templateId = maintTemplate[0].id;
      await sql`
        INSERT INTO budget_template_categories (template_id, category_code, category_name, default_percent, sort_order, color)
        VALUES
          (${templateId}, 'LABOR', 'Labor & Technicians', 40.00, 1, '#22c55e'),
          (${templateId}, 'MATERIALS', 'Replacement Parts', 25.00, 2, '#3b82f6'),
          (${templateId}, 'EQUIPMENT', 'Test Equipment', 10.00, 3, '#8b5cf6'),
          (${templateId}, 'TRANSPORT', 'Transport & Travel', 15.00, 4, '#06b6d4'),
          (${templateId}, 'CONTINGENCY', 'Emergency Reserve', 10.00, 5, '#ef4444')
        ON CONFLICT (template_id, category_code) DO NOTHING
      `;
    }
    console.log('✓ Maintenance template created');

    console.log('Inserting Civil Works template...');
    await sql`
      INSERT INTO budget_templates (code, name, description, template_type, is_system) VALUES
        ('CIVIL_WORKS', 'Civil Works', 'Budget template for civil construction work', 'project', true)
      ON CONFLICT (code) DO NOTHING
    `;

    const civilTemplate = await sql`SELECT id FROM budget_templates WHERE code = 'CIVIL_WORKS'`;
    if (civilTemplate.length > 0) {
      const templateId = civilTemplate[0].id;
      await sql`
        INSERT INTO budget_template_categories (template_id, category_code, category_name, default_percent, sort_order, color)
        VALUES
          (${templateId}, 'LABOR', 'Labor & Crews', 35.00, 1, '#22c55e'),
          (${templateId}, 'MATERIALS', 'Construction Materials', 30.00, 2, '#3b82f6'),
          (${templateId}, 'EQUIPMENT', 'Heavy Equipment Rental', 15.00, 3, '#8b5cf6'),
          (${templateId}, 'SUBCONTRACT', 'Subcontractors', 10.00, 4, '#f59e0b'),
          (${templateId}, 'PERMITS', 'Permits & Fees', 5.00, 5, '#06b6d4'),
          (${templateId}, 'CONTINGENCY', 'Contingency', 5.00, 6, '#ef4444')
        ON CONFLICT (template_id, category_code) DO NOTHING
      `;
    }
    console.log('✓ Civil Works template created');

    // Step 6: Create views
    console.log('Creating views...');
    await sql`
      CREATE OR REPLACE VIEW v_budget_templates_summary AS
      SELECT
        bt.id,
        bt.code,
        bt.name,
        bt.description,
        bt.template_type,
        bt.default_currency,
        bt.default_enforce_budget,
        bt.default_warning_threshold,
        bt.default_critical_threshold,
        bt.is_active,
        bt.is_system,
        bt.usage_count,
        bt.last_used_at,
        bt.created_at,
        COUNT(btc.id) AS category_count,
        COALESCE(SUM(btc.default_percent), 0) AS total_percent
      FROM budget_templates bt
      LEFT JOIN budget_template_categories btc ON bt.id = btc.template_id
      GROUP BY bt.id
    `;
    console.log('✓ v_budget_templates_summary view created');

    await sql`
      CREATE OR REPLACE VIEW v_project_budgets_dashboard AS
      SELECT
        pb.id,
        pb.project_id,
        p.project_code,
        p.project_name,
        pb.source_type,
        pb.total_budget,
        pb.committed_amount,
        pb.actual_amount,
        pb.available_budget,
        pb.variance_amount,
        pb.variance_percent,
        pb.status,
        pb.enforce_budget,
        pb.currency,
        CASE
          WHEN pb.total_budget > 0 THEN
            ROUND((pb.committed_amount / pb.total_budget * 100)::numeric, 2)
          ELSE 0
        END AS utilization_percent,
        CASE
          WHEN pb.total_budget > 0 THEN
            CASE
              WHEN pb.committed_amount / pb.total_budget >= pb.alert_threshold_critical / 100 THEN 'critical'
              WHEN pb.committed_amount / pb.total_budget >= pb.alert_threshold_warning / 100 THEN 'warning'
              ELSE 'healthy'
            END
          ELSE 'healthy'
        END AS health_status,
        pb.alert_threshold_warning,
        pb.alert_threshold_critical,
        (SELECT COUNT(*) FROM budget_alerts WHERE project_budget_id = pb.id AND status = 'active') AS active_alerts,
        (SELECT COUNT(*) FROM budget_categories WHERE project_budget_id = pb.id) AS category_count,
        pb.created_at,
        pb.updated_at
      FROM project_budgets pb
      LEFT JOIN projects p ON pb.project_id = p.id
    `;
    console.log('✓ v_project_budgets_dashboard view created');

    // Step 7: Create function
    console.log('Creating create_budget_from_template function...');
    await sql`
      CREATE OR REPLACE FUNCTION create_budget_from_template(
        p_project_id UUID,
        p_template_id UUID,
        p_total_budget DECIMAL(15,2),
        p_created_by VARCHAR(100) DEFAULT NULL
      )
      RETURNS UUID AS $$
      DECLARE
        v_budget_id UUID;
        v_template RECORD;
      BEGIN
        SELECT * INTO v_template FROM budget_templates WHERE id = p_template_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Template not found';
        END IF;

        INSERT INTO project_budgets (
          project_id,
          source_type,
          total_budget,
          available_budget,
          currency,
          enforce_budget,
          allow_override,
          alert_threshold_warning,
          alert_threshold_critical,
          status,
          created_by
        ) VALUES (
          p_project_id,
          'manual',
          p_total_budget,
          p_total_budget,
          v_template.default_currency,
          v_template.default_enforce_budget,
          v_template.default_allow_override,
          v_template.default_warning_threshold,
          v_template.default_critical_threshold,
          'draft',
          p_created_by
        )
        RETURNING id INTO v_budget_id;

        INSERT INTO budget_categories (
          project_budget_id,
          category_code,
          category_name,
          allocated_amount,
          available_amount,
          sort_order
        )
        SELECT
          v_budget_id,
          btc.category_code,
          btc.category_name,
          CASE
            WHEN btc.default_percent IS NOT NULL THEN
              ROUND((p_total_budget * btc.default_percent / 100)::numeric, 2)
            ELSE
              COALESCE(btc.default_amount, 0)
          END,
          CASE
            WHEN btc.default_percent IS NOT NULL THEN
              ROUND((p_total_budget * btc.default_percent / 100)::numeric, 2)
            ELSE
              COALESCE(btc.default_amount, 0)
          END,
          btc.sort_order
        FROM budget_template_categories btc
        WHERE btc.template_id = p_template_id
        ORDER BY btc.sort_order;

        UPDATE budget_templates SET
          usage_count = usage_count + 1,
          last_used_at = NOW()
        WHERE id = p_template_id;

        RETURN v_budget_id;
      END;
      $$ LANGUAGE plpgsql
    `;
    console.log('✓ create_budget_from_template function created');

    // Verify
    console.log('\nVerifying migration...');
    const templates = await sql`SELECT code, name FROM budget_templates ORDER BY code`;
    console.log('Budget templates:', templates.map(t => t.code).join(', '));

    const categories = await sql`SELECT COUNT(*) as count FROM budget_template_categories`;
    console.log('Template categories:', categories[0].count);

    console.log('\n✅ Migration 106_budget_templates.sql completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  }
}

runMigration().catch(console.error);
