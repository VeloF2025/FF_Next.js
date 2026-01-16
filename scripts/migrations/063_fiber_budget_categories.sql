-- Migration: 063_fiber_budget_categories
-- Description: Fiber-specific budget categories replacing generic categories
-- Created: 2026-01-17
-- Related: BOQ Import & Budget Item Integration Plan

-- ============================================
-- 1. Create boq_category_mapping table
-- ============================================
CREATE TABLE IF NOT EXISTS boq_category_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- BOQ category name (from Item Category column)
    boq_category VARCHAR(255) NOT NULL,

    -- Target budget category code
    budget_category_code VARCHAR(50) NOT NULL,

    -- Keywords for fuzzy matching (when exact match fails)
    keywords TEXT[],

    -- Priority for matching (lower = higher priority)
    priority INTEGER DEFAULT 100,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Unique mapping per BOQ category
    CONSTRAINT unique_boq_category_mapping UNIQUE (boq_category)
);

-- ============================================
-- 2. Create function to seed fiber budget categories
-- ============================================
CREATE OR REPLACE FUNCTION seed_fiber_budget_categories(p_budget_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO budget_categories (project_budget_id, category_code, category_name, sort_order, is_custom)
    VALUES
        (p_budget_id, 'CABLES', 'Cables & Fiber', 1, false),
        (p_budget_id, 'ENCLOSURES', 'Enclosures & Joints', 2, false),
        (p_budget_id, 'POLES', 'Poles & Structures', 3, false),
        (p_budget_id, 'HARDWARE', 'Hardware & Fittings', 4, false),
        (p_budget_id, 'SPLICING', 'Splicing & Connectivity', 5, false),
        (p_budget_id, 'CIVIL', 'Civil Works & Ducting', 6, false),
        (p_budget_id, 'HOME_CONNECTION', 'Home Connection', 7, false),
        (p_budget_id, 'CONSUMABLES', 'Consumables & Sundries', 8, false),
        (p_budget_id, 'LABOR', 'Labor & Services', 9, false),
        (p_budget_id, 'CONTINGENCY', 'Contingency Reserve', 10, false)
    ON CONFLICT (project_budget_id, category_code) DO NOTHING;
END;
$$;

-- ============================================
-- 3. Seed BOQ category mappings
-- ============================================
-- Clear existing mappings for clean insert
TRUNCATE boq_category_mapping;

-- CABLES - All cable types
INSERT INTO boq_category_mapping (boq_category, budget_category_code, keywords, priority) VALUES
    -- Drop Cables
    ('Drop Cable (Connectorised)', 'CABLES', ARRAY['drop', 'cable', 'connectorised', 'fiber'], 1),
    ('SC/APC Connector for drop cable', 'CABLES', ARRAY['sc', 'apc', 'connector', 'drop', 'cable'], 1),
    -- Aerial Cables
    ('Aerial Cable (ADSS)', 'CABLES', ARRAY['aerial', 'cable', 'adss', 'fiber'], 1),
    ('Aerial Cable (ADSS Slimline)', 'CABLES', ARRAY['aerial', 'cable', 'adss', 'slimline'], 1),
    ('Aerial Cable (Mini-ADSS)', 'CABLES', ARRAY['aerial', 'cable', 'mini', 'adss'], 1),
    -- Underground Cables
    ('Underground Cable (Micro-Blown)', 'CABLES', ARRAY['underground', 'cable', 'micro', 'blown'], 1),
    -- Power Cables
    ('Power Cable Kit', 'CABLES', ARRAY['power', 'cable', 'kit'], 1);

-- ENCLOSURES - Enclosures, joints, splice closures
INSERT INTO boq_category_mapping (boq_category, budget_category_code, keywords, priority) VALUES
    ('Enclosure (Connectorised)', 'ENCLOSURES', ARRAY['enclosure', 'connectorised', 'fdt', 'nap'], 2),
    ('Enclosure  (Splice)', 'ENCLOSURES', ARRAY['enclosure', 'splice', 'closure'], 2);

-- POLES - Poles and related structures
INSERT INTO boq_category_mapping (boq_category, budget_category_code, keywords, priority) VALUES
    ('Poles (Creosote)', 'POLES', ARRAY['pole', 'creosote', 'wood'], 3),
    ('Stay Set', 'POLES', ARRAY['stay', 'set', 'wire', 'anchor', 'guy'], 3);

-- HARDWARE - Dead-ends, tangents, hooks, brackets, strapping
INSERT INTO boq_category_mapping (boq_category, budget_category_code, keywords, priority) VALUES
    -- Dead-Ends
    ('Dead-End(ADSS)', 'HARDWARE', ARRAY['dead', 'end', 'adss', 'termination'], 4),
    ('Dead-End(Mini-ADSS)', 'HARDWARE', ARRAY['dead', 'end', 'mini', 'adss'], 4),
    ('Dead-End(Drop)', 'HARDWARE', ARRAY['dead', 'end', 'drop'], 4),
    -- Tangents
    ('Tangent (ADSS)', 'HARDWARE', ARRAY['tangent', 'adss', 'clamp'], 4),
    ('Tangent (Mini-ADSS)', 'HARDWARE', ARRAY['tangent', 'mini', 'adss'], 4),
    -- Hooks
    ('Hook (Monopole Bracket Offset)', 'HARDWARE', ARRAY['hook', 'monopole', 'bracket', 'offset'], 4),
    ('Hook (Pigtail)', 'HARDWARE', ARRAY['hook', 'pigtail'], 4),
    -- Slack Brackets
    ('Slack Bracket (Bracket)', 'HARDWARE', ARRAY['slack', 'bracket'], 4),
    ('Slack Bracket (Slack Storage Box)', 'HARDWARE', ARRAY['slack', 'storage', 'box'], 4),
    ('Slack Bracket (Branded Box)', 'HARDWARE', ARRAY['slack', 'branded', 'box'], 4),
    -- Strapping
    ('Strapping (Steel)', 'HARDWARE', ARRAY['strapping', 'steel', 'band'], 4),
    ('Buckle (Steel)', 'HARDWARE', ARRAY['buckle', 'steel'], 4),
    ('Coach Screws', 'HARDWARE', ARRAY['coach', 'screws'], 4),
    -- Cable Ties & Screws
    ('Cable Tie', 'HARDWARE', ARRAY['cable', 'tie', 'zip'], 4),
    ('Screw', 'HARDWARE', ARRAY['screw'], 4),
    ('Screws', 'HARDWARE', ARRAY['screws'], 4);

-- SPLICING - Splitters, pigtails, midcouplers, connectors, splice protectors
INSERT INTO boq_category_mapping (boq_category, budget_category_code, keywords, priority) VALUES
    -- Splitters
    ('Splitter (Bare)', 'SPLICING', ARRAY['splitter', 'bare', 'plc'], 5),
    ('Splitter (Connectorised)', 'SPLICING', ARRAY['splitter', 'connectorised'], 5),
    -- Pigtails
    ('Pigtail (Connectorised)', 'SPLICING', ARRAY['pigtail', 'connectorised', 'fiber'], 5),
    -- Midcouplers
    ('Midcoupler (Flangeless)', 'SPLICING', ARRAY['midcoupler', 'flangeless', 'adapter'], 5),
    ('Midcoupler (Flanged)', 'SPLICING', ARRAY['midcoupler', 'flanged', 'adapter'], 5),
    -- Splice Protectors
    ('Splice Protector', 'SPLICING', ARRAY['splice', 'protector', 'sleeve', 'heat', 'shrink'], 5);

-- CIVIL - Manholes, micro duct, trunking, conduit, couplings, end caps
INSERT INTO boq_category_mapping (boq_category, budget_category_code, keywords, priority) VALUES
    -- Manholes
    ('Access Chamber (Manhole)', 'CIVIL', ARRAY['access', 'chamber', 'manhole', 'pit'], 6),
    ('Access Chamber (Manhole Key)', 'CIVIL', ARRAY['manhole', 'key', 'access'], 6),
    -- Micro Duct
    ('Micro Duct (HDPE, Polyethylene)', 'CIVIL', ARRAY['micro', 'duct', 'hdpe', 'polyethylene'], 6),
    ('Micro Duct (HDPE, Polyethylene, Combi)', 'CIVIL', ARRAY['micro', 'duct', 'combi'], 6),
    ('Micro Duct (HDPE, Polyethylene, Sub)', 'CIVIL', ARRAY['micro', 'duct', 'sub'], 6),
    ('Micro Duct', 'CIVIL', ARRAY['micro', 'duct'], 6),
    -- Trunking
    ('Trunking (PVC)', 'CIVIL', ARRAY['trunking', 'pvc'], 6),
    -- Conduit
    ('Conduit (Galv)', 'CIVIL', ARRAY['conduit', 'galv', 'galvanized'], 6),
    ('Conduit (Galv, Bend)', 'CIVIL', ARRAY['conduit', 'galv', 'bend'], 6),
    ('Conduit (PVC)', 'CIVIL', ARRAY['conduit', 'pvc'], 6),
    ('Conduit (PVC,Bend)', 'CIVIL', ARRAY['conduit', 'pvc', 'bend'], 6),
    ('Conduit (HDPE)', 'CIVIL', ARRAY['conduit', 'hdpe'], 6),
    ('Conduit (Corr)', 'CIVIL', ARRAY['conduit', 'corrugated'], 6),
    -- Lock Nuts & Adapters
    ('Lock Nut (Galv)', 'CIVIL', ARRAY['lock', 'nut', 'galv'], 6),
    ('Male Adapt (Galv)', 'CIVIL', ARRAY['male', 'adapt', 'adapter', 'galv'], 6),
    ('Male Adapt + L Nut (PVC)', 'CIVIL', ARRAY['male', 'adapt', 'lock', 'nut', 'pvc'], 6),
    -- Couplings & End Caps
    ('Coupling (PVC Conduit)', 'CIVIL', ARRAY['coupling', 'pvc', 'conduit'], 6),
    ('Coupling (Micro Duct)', 'CIVIL', ARRAY['coupling', 'micro', 'duct'], 6),
    ('End Cap (Micro Duct)', 'CIVIL', ARRAY['end', 'cap', 'micro', 'duct'], 6);

-- HOME_CONNECTION - Wall attachments, inspection boxes, ONT-related
INSERT INTO boq_category_mapping (boq_category, budget_category_code, keywords, priority) VALUES
    -- Wall Attachments
    ('Wall Attachment', 'HOME_CONNECTION', ARRAY['wall', 'attachment'], 7),
    ('Wall Attchment', 'HOME_CONNECTION', ARRAY['wall', 'attchment'], 7), -- Typo variant
    ('Wall Attachment (Insp Box PVC)', 'HOME_CONNECTION', ARRAY['wall', 'attachment', 'inspection', 'box', 'pvc'], 7),
    ('Wall Attachment (Insp Box Galv)', 'HOME_CONNECTION', ARRAY['wall', 'attachment', 'inspection', 'box', 'galv'], 7),
    ('Wall Attachment (Insp Box GALV)', 'HOME_CONNECTION', ARRAY['wall', 'attachment', 'inspection', 'galv'], 7),
    ('Wall Attachment (Insp Box Lid Galv)', 'HOME_CONNECTION', ARRAY['wall', 'attachment', 'lid', 'galv'], 7),
    ('Wall Attachment (Insp Box Lid PVC)', 'HOME_CONNECTION', ARRAY['wall', 'attachment', 'lid', 'pvc'], 7),
    ('Wall Attachment (Saddle Galv)', 'HOME_CONNECTION', ARRAY['wall', 'attachment', 'saddle', 'galv'], 7),
    ('Wall Attachment (Saddle PVC)', 'HOME_CONNECTION', ARRAY['wall', 'attachment', 'saddle', 'pvc'], 7),
    -- Electrical (for ONT power)
    ('Electrical', 'HOME_CONNECTION', ARRAY['electrical', 'power', 'ont'], 7);

-- CONSUMABLES - Labels, cement, tar, alcohol, wipes, tape
INSERT INTO boq_category_mapping (boq_category, budget_category_code, keywords, priority) VALUES
    -- Labels
    ('Label (Brady)', 'CONSUMABLES', ARRAY['label', 'brady'], 8),
    ('Label (Chromadek)', 'CONSUMABLES', ARRAY['label', 'chromadek'], 8),
    ('Label', 'CONSUMABLES', ARRAY['label'], 8),
    -- Cement & Tar
    ('Cement Bag', 'CONSUMABLES', ARRAY['cement', 'bag'], 8),
    ('Tar Bag', 'CONSUMABLES', ARRAY['tar', 'bag'], 8),
    ('Bituman (SC60)', 'CONSUMABLES', ARRAY['bituman', 'bitumen', 'sc60'], 8),
    -- Tape
    ('Caution Tape (Trench)', 'CONSUMABLES', ARRAY['caution', 'tape', 'trench', 'warning'], 8),
    -- Cleaning
    ('Alcohol (Aerosol)', 'CONSUMABLES', ARRAY['alcohol', 'aerosol', 'cleaning'], 8),
    ('Kim Wipes', 'CONSUMABLES', ARRAY['kim', 'wipes', 'cleaning'], 8);

-- ============================================
-- 4. Create indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_boq_category_mapping_code ON boq_category_mapping(budget_category_code);
CREATE INDEX IF NOT EXISTS idx_boq_category_mapping_keywords ON boq_category_mapping USING GIN (keywords);

-- ============================================
-- 5. Create function to map BOQ category to budget category
-- ============================================
CREATE OR REPLACE FUNCTION map_boq_to_budget_category(p_boq_category VARCHAR(255))
RETURNS VARCHAR(50)
LANGUAGE plpgsql
AS $$
DECLARE
    v_budget_code VARCHAR(50);
BEGIN
    -- First try exact match
    SELECT budget_category_code INTO v_budget_code
    FROM boq_category_mapping
    WHERE LOWER(boq_category) = LOWER(p_boq_category)
    LIMIT 1;

    IF v_budget_code IS NOT NULL THEN
        RETURN v_budget_code;
    END IF;

    -- If no exact match, try keyword-based fallback
    -- Extract keywords from input and match
    SELECT budget_category_code INTO v_budget_code
    FROM boq_category_mapping
    WHERE keywords && (
        SELECT ARRAY_AGG(LOWER(word))
        FROM regexp_split_to_table(p_boq_category, '[^a-zA-Z0-9]+') AS word
        WHERE LENGTH(word) > 2
    )
    ORDER BY priority ASC
    LIMIT 1;

    IF v_budget_code IS NOT NULL THEN
        RETURN v_budget_code;
    END IF;

    -- Default to CONSUMABLES if no match
    RETURN 'CONSUMABLES';
END;
$$;

-- ============================================
-- 6. Create view for category summary
-- ============================================
CREATE OR REPLACE VIEW v_budget_category_summary AS
SELECT
    bc.project_budget_id,
    bc.category_code,
    bc.category_name,
    bc.allocated_amount,
    bc.committed_amount,
    bc.actual_amount,
    bc.available_amount,
    COUNT(bi.id) AS item_count,
    SUM(bi.budgeted_amount) AS items_budgeted_total,
    SUM(bi.committed_amount) AS items_committed_total,
    SUM(bi.actual_amount) AS items_actual_total
FROM budget_categories bc
LEFT JOIN budget_items bi ON bi.budget_category_id = bc.id
GROUP BY
    bc.project_budget_id,
    bc.id,
    bc.category_code,
    bc.category_name,
    bc.allocated_amount,
    bc.committed_amount,
    bc.actual_amount,
    bc.available_amount;

-- ============================================
-- 7. Comments
-- ============================================
COMMENT ON TABLE boq_category_mapping IS 'Maps BOQ Item Categories to fiber-specific budget categories';
COMMENT ON FUNCTION seed_fiber_budget_categories IS 'Seeds 10 fiber-specific budget categories for a project budget';
COMMENT ON FUNCTION map_boq_to_budget_category IS 'Maps a BOQ category string to budget category code';

-- ============================================
-- Migration complete
-- ============================================
