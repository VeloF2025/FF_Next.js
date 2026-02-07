/**
 * Migration runner for 105_cost_centers.sql
 * Run with: node scripts/migrations/run-migration-105.js
 */

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

const sql = neon(DATABASE_URL);

async function runMigration() {
  console.log('Running migration 105_cost_centers.sql...\n');

  try {
    // Step 1: Create cost_center_types table
    console.log('Creating cost_center_types table...');
    await sql`
      CREATE TABLE IF NOT EXISTS cost_center_types (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        hierarchy_level INTEGER NOT NULL DEFAULT 1,
        is_active BOOLEAN DEFAULT true,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log('✓ cost_center_types table created');

    // Step 2: Insert default types
    console.log('Inserting default cost center types...');
    await sql`
      INSERT INTO cost_center_types (code, name, description, hierarchy_level, sort_order) VALUES
        ('project', 'Project', 'Top-level project cost center', 1, 1),
        ('phase', 'Phase', 'Project phase (civil, optical, drops)', 2, 2),
        ('zone', 'Zone', 'Geographic zone within project', 3, 3),
        ('pon', 'PON', 'Passive Optical Network area', 3, 4),
        ('pole', 'Pole', 'Individual pole/structure', 4, 5),
        ('drop', 'Drop', 'Individual customer drop', 4, 6),
        ('department', 'Department', 'Internal department', 2, 7),
        ('team', 'Team', 'Work team or crew', 3, 8)
      ON CONFLICT (code) DO NOTHING
    `;
    console.log('✓ Default cost center types inserted');

    // Step 3: Create cost_centers table
    console.log('Creating cost_centers table...');
    await sql`
      CREATE TABLE IF NOT EXISTS cost_centers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        parent_id UUID REFERENCES cost_centers(id) ON DELETE CASCADE,
        cost_center_type_id UUID REFERENCES cost_center_types(id),
        hierarchy_path TEXT,
        depth INTEGER DEFAULT 1,
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        allocated_budget DECIMAL(15,2) DEFAULT 0,
        committed_amount DECIMAL(15,2) DEFAULT 0,
        actual_amount DECIMAL(15,2) DEFAULT 0,
        available_amount DECIMAL(15,2) DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        is_locked BOOLEAN DEFAULT false,
        reference_type VARCHAR(50),
        reference_id UUID,
        sort_order INTEGER DEFAULT 0,
        metadata JSONB DEFAULT '{}',
        created_by VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT uq_cost_center_project_code UNIQUE (project_id, code)
      )
    `;
    console.log('✓ cost_centers table created');

    // Step 4: Create cost_center_allocations table
    console.log('Creating cost_center_allocations table...');
    await sql`
      CREATE TABLE IF NOT EXISTS cost_center_allocations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cost_center_id UUID NOT NULL REFERENCES cost_centers(id) ON DELETE CASCADE,
        budget_category_id UUID REFERENCES budget_categories(id),
        budget_item_id UUID REFERENCES budget_items(id),
        allocation_type VARCHAR(50) NOT NULL DEFAULT 'budget',
        amount DECIMAL(15,2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'ZAR',
        reference_type VARCHAR(50),
        reference_id UUID,
        reference_number VARCHAR(100),
        description TEXT,
        fiscal_year INTEGER,
        fiscal_period INTEGER,
        created_by VARCHAR(100),
        approved_by VARCHAR(100),
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log('✓ cost_center_allocations table created');

    // Step 5: Create cost_center_transactions table
    console.log('Creating cost_center_transactions table...');
    await sql`
      CREATE TABLE IF NOT EXISTS cost_center_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cost_center_id UUID NOT NULL REFERENCES cost_centers(id) ON DELETE CASCADE,
        allocation_id UUID REFERENCES cost_center_allocations(id),
        transaction_type VARCHAR(50) NOT NULL,
        transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
        amount DECIMAL(15,2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'ZAR',
        reference_type VARCHAR(50),
        reference_id UUID,
        reference_number VARCHAR(100),
        description TEXT,
        stock_item_id UUID REFERENCES stock_items(id),
        quantity DECIMAL(12,4),
        unit_cost DECIMAL(15,4),
        status VARCHAR(50) DEFAULT 'pending',
        created_by VARCHAR(100),
        approved_by VARCHAR(100),
        approved_at TIMESTAMPTZ,
        posted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log('✓ cost_center_transactions table created');

    // Step 6: Create indexes
    console.log('Creating indexes...');
    await sql`CREATE INDEX IF NOT EXISTS idx_cost_centers_parent ON cost_centers(parent_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cost_centers_project ON cost_centers(project_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cost_centers_type ON cost_centers(cost_center_type_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cost_centers_hierarchy ON cost_centers(hierarchy_path)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cost_centers_reference ON cost_centers(reference_type, reference_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cc_allocations_center ON cost_center_allocations(cost_center_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cc_allocations_category ON cost_center_allocations(budget_category_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cc_transactions_center ON cost_center_transactions(cost_center_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cc_transactions_date ON cost_center_transactions(transaction_date)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cc_transactions_status ON cost_center_transactions(status)`;
    console.log('✓ Indexes created');

    // Step 7: Create trigger function for hierarchy
    console.log('Creating hierarchy trigger...');
    await sql`
      CREATE OR REPLACE FUNCTION update_cost_center_hierarchy()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.parent_id IS NULL THEN
          NEW.hierarchy_path := '/' || NEW.id::text;
          NEW.depth := 1;
        ELSE
          SELECT hierarchy_path || '/' || NEW.id::text, depth + 1
          INTO NEW.hierarchy_path, NEW.depth
          FROM cost_centers
          WHERE id = NEW.parent_id;
        END IF;
        NEW.updated_at := NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `;

    await sql`DROP TRIGGER IF EXISTS trg_cost_center_hierarchy ON cost_centers`;
    await sql`
      CREATE TRIGGER trg_cost_center_hierarchy
        BEFORE INSERT OR UPDATE OF parent_id ON cost_centers
        FOR EACH ROW
        EXECUTE FUNCTION update_cost_center_hierarchy()
    `;
    console.log('✓ Hierarchy trigger created');

    // Step 8: Create trigger function for totals
    console.log('Creating totals trigger...');
    await sql`
      CREATE OR REPLACE FUNCTION update_cost_center_totals()
      RETURNS TRIGGER AS $$
      DECLARE
        v_cost_center_id UUID;
      BEGIN
        IF TG_OP = 'DELETE' THEN
          v_cost_center_id := OLD.cost_center_id;
        ELSE
          v_cost_center_id := NEW.cost_center_id;
        END IF;

        UPDATE cost_centers cc SET
          committed_amount = COALESCE((
            SELECT SUM(amount) FROM cost_center_allocations
            WHERE cost_center_id = cc.id AND allocation_type = 'commitment'
          ), 0),
          actual_amount = COALESCE((
            SELECT SUM(amount) FROM cost_center_transactions
            WHERE cost_center_id = cc.id AND status = 'posted' AND transaction_type = 'expense'
          ), 0),
          available_amount = cc.allocated_budget - COALESCE((
            SELECT SUM(amount) FROM cost_center_allocations
            WHERE cost_center_id = cc.id AND allocation_type = 'commitment'
          ), 0),
          updated_at = NOW()
        WHERE id = v_cost_center_id;

        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql
    `;

    await sql`DROP TRIGGER IF EXISTS trg_cc_allocation_totals ON cost_center_allocations`;
    await sql`
      CREATE TRIGGER trg_cc_allocation_totals
        AFTER INSERT OR UPDATE OR DELETE ON cost_center_allocations
        FOR EACH ROW
        EXECUTE FUNCTION update_cost_center_totals()
    `;

    await sql`DROP TRIGGER IF EXISTS trg_cc_transaction_totals ON cost_center_transactions`;
    await sql`
      CREATE TRIGGER trg_cc_transaction_totals
        AFTER INSERT OR UPDATE OR DELETE ON cost_center_transactions
        FOR EACH ROW
        EXECUTE FUNCTION update_cost_center_totals()
    `;
    console.log('✓ Totals triggers created');

    // Step 9: Create summary view
    console.log('Creating summary view...');
    await sql`
      CREATE OR REPLACE VIEW v_cost_centers_summary AS
      SELECT
        cc.id,
        cc.code,
        cc.name,
        cc.description,
        cc.parent_id,
        parent.code AS parent_code,
        parent.name AS parent_name,
        cct.code AS type_code,
        cct.name AS type_name,
        cct.hierarchy_level,
        cc.hierarchy_path,
        cc.depth,
        cc.project_id,
        p.project_code,
        p.project_name,
        cc.allocated_budget,
        cc.committed_amount,
        cc.actual_amount,
        cc.available_amount,
        CASE
          WHEN cc.allocated_budget > 0 THEN
            ROUND((cc.actual_amount / cc.allocated_budget * 100)::numeric, 2)
          ELSE 0
        END AS utilization_percent,
        CASE
          WHEN cc.allocated_budget > 0 THEN
            ROUND((cc.committed_amount / cc.allocated_budget * 100)::numeric, 2)
          ELSE 0
        END AS commitment_percent,
        cc.is_active,
        cc.is_locked,
        cc.reference_type,
        cc.reference_id,
        cc.created_at,
        cc.updated_at,
        (SELECT COUNT(*) FROM cost_centers WHERE parent_id = cc.id) AS child_count,
        (SELECT COUNT(*) FROM cost_center_transactions WHERE cost_center_id = cc.id) AS transaction_count
      FROM cost_centers cc
      LEFT JOIN cost_centers parent ON cc.parent_id = parent.id
      LEFT JOIN cost_center_types cct ON cc.cost_center_type_id = cct.id
      LEFT JOIN projects p ON cc.project_id = p.id
    `;
    console.log('✓ v_cost_centers_summary view created');

    // Step 10: Create recursive tree view
    console.log('Creating tree view...');
    await sql`
      CREATE OR REPLACE VIEW v_cost_center_tree AS
      WITH RECURSIVE cost_tree AS (
        SELECT
          id,
          code,
          name,
          parent_id,
          project_id,
          allocated_budget,
          committed_amount,
          actual_amount,
          available_amount,
          1 AS level,
          ARRAY[sort_order] AS sort_path,
          code::TEXT AS full_path
        FROM cost_centers
        WHERE parent_id IS NULL AND is_active = true

        UNION ALL

        SELECT
          cc.id,
          cc.code,
          cc.name,
          cc.parent_id,
          cc.project_id,
          cc.allocated_budget,
          cc.committed_amount,
          cc.actual_amount,
          cc.available_amount,
          ct.level + 1,
          ct.sort_path || cc.sort_order,
          ct.full_path || ' > ' || cc.code::TEXT
        FROM cost_centers cc
        JOIN cost_tree ct ON cc.parent_id = ct.id
        WHERE cc.is_active = true
      )
      SELECT * FROM cost_tree
      ORDER BY sort_path
    `;
    console.log('✓ v_cost_center_tree view created');

    // Step 11: Create helper functions
    console.log('Creating helper functions...');
    await sql`
      CREATE OR REPLACE FUNCTION get_cost_center_descendants(p_cost_center_id UUID)
      RETURNS TABLE (
        id UUID,
        code VARCHAR(50),
        name VARCHAR(255),
        depth INTEGER,
        allocated_budget DECIMAL(15,2),
        committed_amount DECIMAL(15,2),
        actual_amount DECIMAL(15,2)
      ) AS $$
      WITH RECURSIVE descendants AS (
        SELECT
          cc.id,
          cc.code,
          cc.name,
          cc.depth,
          cc.allocated_budget,
          cc.committed_amount,
          cc.actual_amount
        FROM cost_centers cc
        WHERE cc.id = p_cost_center_id

        UNION ALL

        SELECT
          cc.id,
          cc.code,
          cc.name,
          cc.depth,
          cc.allocated_budget,
          cc.committed_amount,
          cc.actual_amount
        FROM cost_centers cc
        JOIN descendants d ON cc.parent_id = d.id
      )
      SELECT * FROM descendants;
      $$ LANGUAGE sql
    `;

    await sql`
      CREATE OR REPLACE FUNCTION rollup_cost_center_totals(p_cost_center_id UUID)
      RETURNS TABLE (
        total_allocated DECIMAL(15,2),
        total_committed DECIMAL(15,2),
        total_actual DECIMAL(15,2),
        total_available DECIMAL(15,2)
      ) AS $$
        SELECT
          SUM(allocated_budget) AS total_allocated,
          SUM(committed_amount) AS total_committed,
          SUM(actual_amount) AS total_actual,
          SUM(allocated_budget) - SUM(committed_amount) AS total_available
        FROM get_cost_center_descendants(p_cost_center_id);
      $$ LANGUAGE sql
    `;
    console.log('✓ Helper functions created');

    // Verify tables were created
    console.log('\nVerifying migration...');
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name LIKE 'cost_center%'
      ORDER BY table_name
    `;
    console.log('Cost center tables:', tables.map(t => t.table_name).join(', '));

    const types = await sql`SELECT code, name FROM cost_center_types ORDER BY sort_order`;
    console.log('Cost center types:', types.map(t => t.code).join(', '));

    console.log('\n✅ Migration 105_cost_centers.sql completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  }
}

runMigration().catch(console.error);
