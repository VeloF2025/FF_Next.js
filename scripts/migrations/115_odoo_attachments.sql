-- Migration: 115_odoo_attachments
-- Odoo Document/Attachment Sync Support
-- Created: 2026-01-23
-- Description: Add table for syncing Odoo ir.attachment documents to FibreFlow

-- ============================================
-- 1. Odoo Documents Table
-- ============================================
-- Tracks all documents synced from Odoo ir.attachment model
-- Links to FF entities via odoo_*_id mappings where possible
-- Orphaned documents stored with sync_status='orphaned' for manual review

CREATE TABLE IF NOT EXISTS odoo_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Odoo Reference
    odoo_attachment_id INTEGER UNIQUE NOT NULL,    -- ir.attachment.id
    odoo_model VARCHAR(100) NOT NULL,              -- res_model: 'purchase.order', 'fleet.vehicle', etc.
    odoo_record_id INTEGER NOT NULL,               -- res_id: linked record in Odoo
    odoo_write_date TIMESTAMP WITH TIME ZONE,      -- Odoo write_date for change detection

    -- FibreFlow Entity Link (NULL if orphaned)
    ff_entity_type VARCHAR(50),                    -- 'purchase_order', 'vehicle', 'product', 'supplier', 'grn'
    ff_entity_id UUID,                             -- Link to FF record

    -- Document Classification
    document_type VARCHAR(50) NOT NULL DEFAULT 'other',  -- 'invoice', 'delivery_note', 'receipt', 'image', 'contract', 'other'
    document_name VARCHAR(255) NOT NULL,           -- Display name
    description TEXT,                              -- From Odoo description field

    -- File Storage (VF Storage)
    file_name VARCHAR(255) NOT NULL,               -- Original filename from Odoo
    file_path TEXT NOT NULL,                       -- VF Storage path: /odoo-docs/{model}/{ff_id}/filename
    file_url TEXT NOT NULL,                        -- VF Storage URL
    file_size BIGINT,                              -- File size in bytes
    mime_type VARCHAR(100),                        -- MIME type
    file_hash VARCHAR(64),                         -- MD5 hash for deduplication

    -- Sync Status
    sync_status VARCHAR(30) DEFAULT 'synced' CHECK (sync_status IN (
        'pending',      -- Queued for download
        'downloading',  -- Currently downloading from Odoo
        'uploading',    -- Currently uploading to VF Storage
        'synced',       -- Successfully synced and linked
        'orphaned',     -- Synced but couldn't link to FF entity
        'failed'        -- Sync failed
    )),
    sync_error TEXT,                               -- Error message if failed
    sync_attempts INTEGER DEFAULT 0,               -- Number of sync attempts
    last_sync_attempt TIMESTAMP WITH TIME ZONE,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_odoo_docs_attachment_id ON odoo_documents(odoo_attachment_id);
CREATE INDEX IF NOT EXISTS idx_odoo_docs_model_record ON odoo_documents(odoo_model, odoo_record_id);
CREATE INDEX IF NOT EXISTS idx_odoo_docs_ff_entity ON odoo_documents(ff_entity_type, ff_entity_id) WHERE ff_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_odoo_docs_sync_status ON odoo_documents(sync_status);
CREATE INDEX IF NOT EXISTS idx_odoo_docs_file_hash ON odoo_documents(file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_odoo_docs_document_type ON odoo_documents(document_type);

-- ============================================
-- 2. Document Type Auto-Detection Rules
-- ============================================
-- Rules for automatically classifying documents based on filename patterns

CREATE TABLE IF NOT EXISTS odoo_document_type_rules (
    id SERIAL PRIMARY KEY,
    odoo_model VARCHAR(100) NOT NULL,              -- Which Odoo model this rule applies to
    filename_pattern VARCHAR(255) NOT NULL,        -- Regex pattern to match filename
    document_type VARCHAR(50) NOT NULL,            -- Resulting document type
    priority INTEGER DEFAULT 0,                    -- Higher priority = checked first
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Default classification rules
INSERT INTO odoo_document_type_rules (odoo_model, filename_pattern, document_type, priority) VALUES
    -- Purchase Order documents
    ('purchase.order', '(?i)invoice', 'invoice', 100),
    ('purchase.order', '(?i)inv[_-]', 'invoice', 90),
    ('purchase.order', '(?i)bill', 'invoice', 80),
    ('purchase.order', '(?i)delivery.*note', 'delivery_note', 100),
    ('purchase.order', '(?i)dn[_-]', 'delivery_note', 90),
    ('purchase.order', '(?i)pod', 'delivery_note', 80),
    ('purchase.order', '(?i)receipt', 'receipt', 70),
    ('purchase.order', '(?i)contract', 'contract', 70),
    ('purchase.order', '(?i)quote', 'quote', 70),
    ('purchase.order', '(?i)quotation', 'quote', 70),

    -- Product images
    ('product.product', '(?i)\.(jpg|jpeg|png|gif|webp)$', 'product_image', 100),
    ('product.product', '(?i)image', 'product_image', 80),
    ('product.product', '(?i)photo', 'product_image', 80),
    ('product.product', '(?i)spec.*sheet', 'specification', 70),
    ('product.product', '(?i)datasheet', 'specification', 70),

    -- Stock picking / GRN documents
    ('stock.picking', '(?i)delivery', 'delivery_note', 100),
    ('stock.picking', '(?i)receipt', 'receipt', 90),
    ('stock.picking', '(?i)pod', 'delivery_note', 80),
    ('stock.picking', '(?i)grn', 'receipt', 80),

    -- Fleet vehicle documents
    ('fleet.vehicle', '(?i)license', 'license', 100),
    ('fleet.vehicle', '(?i)natis', 'natis', 100),
    ('fleet.vehicle', '(?i)insurance', 'insurance', 100),
    ('fleet.vehicle', '(?i)service', 'service_record', 80),
    ('fleet.vehicle', '(?i)registration', 'registration', 80),

    -- Supplier/Partner documents
    ('res.partner', '(?i)tax', 'tax_document', 100),
    ('res.partner', '(?i)vat', 'tax_document', 90),
    ('res.partner', '(?i)b-?bbee', 'bbbee_certificate', 100),
    ('res.partner', '(?i)cipc', 'company_registration', 100),
    ('res.partner', '(?i)bank', 'bank_details', 80)
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_odoo_doc_rules_model ON odoo_document_type_rules(odoo_model, is_active);

-- ============================================
-- 3. Update odoo_sync_history to track attachment syncs
-- ============================================
-- Add 'attachment' to allowed entity types

DO $$
BEGIN
    -- Drop the old constraint if it exists
    ALTER TABLE odoo_sync_history
        DROP CONSTRAINT IF EXISTS odoo_sync_history_entity_type_check;

    -- Add new constraint with 'attachment' included
    ALTER TABLE odoo_sync_history
        ADD CONSTRAINT odoo_sync_history_entity_type_check
        CHECK (entity_type IN (
            'supplier', 'purchase_order', 'transfer', 'fleet', 'asset',
            'product', 'attachment', 'stock_receipt', 'stock_level', 'all'
        ));
EXCEPTION
    WHEN undefined_table THEN
        -- odoo_sync_history doesn't exist, skip
        NULL;
END $$;

-- ============================================
-- 4. Update Trigger for updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_odoo_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_odoo_documents_updated_at ON odoo_documents;
CREATE TRIGGER trigger_odoo_documents_updated_at
    BEFORE UPDATE ON odoo_documents
    FOR EACH ROW EXECUTE FUNCTION update_odoo_documents_updated_at();

-- ============================================
-- 5. Helper Functions
-- ============================================

-- Function to get document type based on rules
CREATE OR REPLACE FUNCTION get_odoo_document_type(
    p_odoo_model VARCHAR(100),
    p_filename VARCHAR(255)
) RETURNS VARCHAR(50) AS $$
DECLARE
    v_document_type VARCHAR(50);
BEGIN
    SELECT document_type INTO v_document_type
    FROM odoo_document_type_rules
    WHERE odoo_model = p_odoo_model
      AND is_active = true
      AND p_filename ~* filename_pattern
    ORDER BY priority DESC
    LIMIT 1;

    RETURN COALESCE(v_document_type, 'other');
END;
$$ LANGUAGE plpgsql;

-- Function to get sync statistics
CREATE OR REPLACE FUNCTION get_odoo_document_sync_stats()
RETURNS TABLE (
    sync_status VARCHAR(30),
    count BIGINT,
    total_size_bytes BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        od.sync_status,
        COUNT(*) as count,
        COALESCE(SUM(od.file_size), 0) as total_size_bytes
    FROM odoo_documents od
    GROUP BY od.sync_status
    ORDER BY count DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. Comments
-- ============================================
COMMENT ON TABLE odoo_documents IS 'Tracks documents synced from Odoo ir.attachment model';
COMMENT ON COLUMN odoo_documents.ff_entity_id IS 'Link to FibreFlow entity - NULL if document could not be linked (orphaned)';
COMMENT ON COLUMN odoo_documents.sync_status IS 'synced=linked, orphaned=synced but unlinked, failed=sync error';
COMMENT ON TABLE odoo_document_type_rules IS 'Auto-classification rules for document types based on filename patterns';
