-- Migration: 178_spare_drop_tracking
-- Spare Drop Tracking: is_spare flag, CPO spare counters, spare_usage_log, triggers
-- Created: 2026-02-14

-- ============================================
-- 1. Add is_spare column to drops
-- ============================================
ALTER TABLE drops ADD COLUMN IF NOT EXISTS is_spare BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_drops_is_spare ON drops(project_id, is_spare) WHERE is_spare = TRUE;

-- ============================================
-- 2. Backfill is_spare from address heuristic
-- ============================================
UPDATE drops
SET is_spare = TRUE
WHERE (address = 'Spare' OR LOWER(address) LIKE '%spare%')
  AND is_spare = FALSE;

-- ============================================
-- 3. Add spare columns to client_purchase_orders
-- ============================================
ALTER TABLE client_purchase_orders
  ADD COLUMN IF NOT EXISTS spares_allocated INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spares_used INTEGER DEFAULT 0;

-- ============================================
-- 4. Create spare_usage_log table
-- ============================================
CREATE TABLE IF NOT EXISTS spare_usage_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    client_po_id UUID REFERENCES client_purchase_orders(id) ON DELETE SET NULL,
    spare_drop_id UUID NOT NULL REFERENCES drops(id),
    spare_drop_number VARCHAR(100) NOT NULL,
    replaced_drop_id UUID REFERENCES drops(id),
    replaced_drop_number VARCHAR(100),
    reason VARCHAR(100) NOT NULL CHECK (reason IN (
        'failed_drop', 'damaged_ont', 'customer_relocation',
        'signal_quality', 'construction_issue', 'other'
    )),
    notes TEXT,
    recorded_by VARCHAR(255) NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spare_usage_project ON spare_usage_log(project_id);
CREATE INDEX IF NOT EXISTS idx_spare_usage_po ON spare_usage_log(client_po_id);
CREATE INDEX IF NOT EXISTS idx_spare_usage_spare_drop ON spare_usage_log(spare_drop_id);
CREATE INDEX IF NOT EXISTS idx_spare_usage_recorded_at ON spare_usage_log(recorded_at DESC);

-- ============================================
-- 5. Backfill spares_allocated from existing data
-- ============================================
UPDATE client_purchase_orders cpo
SET spares_allocated = sub.cnt
FROM (
    SELECT client_po_id, COUNT(*) as cnt
    FROM drops
    WHERE is_spare = TRUE AND client_po_id IS NOT NULL
    GROUP BY client_po_id
) sub
WHERE cpo.id = sub.client_po_id;

-- ============================================
-- 6. Trigger: Update spares_allocated when spare drop assigned/unassigned to PO
-- Follows same pattern as update_client_po_drops_assigned from migration 149
-- ============================================
CREATE OR REPLACE FUNCTION update_client_po_spares_allocated()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Only act on spare drops
    IF NEW.is_spare = TRUE OR OLD.is_spare = TRUE THEN
        -- Spare assigned to PO (NULL -> UUID)
        IF OLD.client_po_id IS NULL AND NEW.client_po_id IS NOT NULL AND NEW.is_spare = TRUE THEN
            UPDATE client_purchase_orders
            SET spares_allocated = spares_allocated + 1,
                updated_at = NOW()
            WHERE id = NEW.client_po_id;

        -- Spare unassigned from PO (UUID -> NULL)
        ELSIF OLD.client_po_id IS NOT NULL AND NEW.client_po_id IS NULL AND OLD.is_spare = TRUE THEN
            UPDATE client_purchase_orders
            SET spares_allocated = GREATEST(0, spares_allocated - 1),
                updated_at = NOW()
            WHERE id = OLD.client_po_id;

        -- Spare reassigned (UUID -> different UUID)
        ELSIF OLD.client_po_id IS NOT NULL AND NEW.client_po_id IS NOT NULL
              AND OLD.client_po_id != NEW.client_po_id AND NEW.is_spare = TRUE THEN
            UPDATE client_purchase_orders
            SET spares_allocated = GREATEST(0, spares_allocated - 1),
                updated_at = NOW()
            WHERE id = OLD.client_po_id;

            UPDATE client_purchase_orders
            SET spares_allocated = spares_allocated + 1,
                updated_at = NOW()
            WHERE id = NEW.client_po_id;

        -- Drop toggled to spare while already assigned to PO
        ELSIF OLD.is_spare = FALSE AND NEW.is_spare = TRUE AND NEW.client_po_id IS NOT NULL THEN
            UPDATE client_purchase_orders
            SET spares_allocated = spares_allocated + 1,
                updated_at = NOW()
            WHERE id = NEW.client_po_id;

        -- Drop toggled from spare while assigned to PO
        ELSIF OLD.is_spare = TRUE AND NEW.is_spare = FALSE AND OLD.client_po_id IS NOT NULL THEN
            UPDATE client_purchase_orders
            SET spares_allocated = GREATEST(0, spares_allocated - 1),
                updated_at = NOW()
            WHERE id = OLD.client_po_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_drops_spares_allocated ON drops;
CREATE TRIGGER trg_drops_spares_allocated
    AFTER UPDATE OF client_po_id, is_spare ON drops
    FOR EACH ROW
    EXECUTE FUNCTION update_client_po_spares_allocated();

-- ============================================
-- 7. Trigger: Increment spares_used when OES activation created on a spare drop
-- Follows same pattern as update_client_po_drops_activated from migration 149
-- ============================================
CREATE OR REPLACE FUNCTION update_client_po_spares_used()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_client_po_id UUID;
    v_is_spare BOOLEAN;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT client_po_id, is_spare INTO v_client_po_id, v_is_spare
        FROM drops
        WHERE id = NEW.drop_id;

        IF v_client_po_id IS NOT NULL AND v_is_spare = TRUE THEN
            UPDATE client_purchase_orders
            SET spares_used = spares_used + 1,
                updated_at = NOW()
            WHERE id = v_client_po_id;
        END IF;

    ELSIF TG_OP = 'DELETE' THEN
        SELECT client_po_id, is_spare INTO v_client_po_id, v_is_spare
        FROM drops
        WHERE id = OLD.drop_id;

        IF v_client_po_id IS NOT NULL AND v_is_spare = TRUE THEN
            UPDATE client_purchase_orders
            SET spares_used = GREATEST(0, spares_used - 1),
                updated_at = NOW()
            WHERE id = v_client_po_id;
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_oes_spares_used ON oes_activations;
CREATE TRIGGER trg_oes_spares_used
    AFTER INSERT OR DELETE ON oes_activations
    FOR EACH ROW
    EXECUTE FUNCTION update_client_po_spares_used();

-- ============================================
-- Migration complete
-- ============================================
COMMENT ON COLUMN drops.is_spare IS 'Whether this is a spare/buffer drop (not part of contracted PO scope)';
COMMENT ON COLUMN client_purchase_orders.spares_allocated IS 'Number of spare drops allocated to this PO (trigger-maintained)';
COMMENT ON COLUMN client_purchase_orders.spares_used IS 'Number of spare drops activated/consumed (trigger-maintained)';
COMMENT ON TABLE spare_usage_log IS 'Log of spare drop consumption events with reason tracking';
