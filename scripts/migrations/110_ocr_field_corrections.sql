-- Migration 108: OCR Field Corrections for HITL Learning
-- Universal OCR learning system that works across all modules
-- Stores field-level corrections for few-shot prompt enhancement

-- Table: ocr_field_corrections
-- Stores human corrections to VLM OCR extractions
CREATE TABLE IF NOT EXISTS ocr_field_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Module identification (e.g., 'staff_documents', 'fleet_checkin', 'activate')
    module_name VARCHAR(100) NOT NULL,

    -- Document/context type (e.g., 'sa_id', 'passport', 'drivers_license', 'license_plate', 'odometer')
    document_type VARCHAR(100) NOT NULL,

    -- Field that was corrected
    field_name VARCHAR(100) NOT NULL,

    -- VLM's original extraction
    vlm_extracted_value TEXT,
    vlm_confidence DECIMAL(5,4),

    -- Human's corrected value (ground truth)
    corrected_value TEXT NOT NULL,

    -- Context for few-shot learning
    image_description TEXT, -- VLM's description of the image
    extraction_context JSONB, -- Additional context (e.g., surrounding text, image quality)

    -- Quality signals
    corrected_by VARCHAR(255),
    correction_reason TEXT,
    reviewed_count INTEGER DEFAULT 0,
    is_canonical BOOLEAN DEFAULT false, -- Curated high-quality examples

    -- Reference to source record (optional)
    source_record_id UUID,
    source_table VARCHAR(100),

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_ocr_corrections_module_doc
    ON ocr_field_corrections(module_name, document_type);

CREATE INDEX IF NOT EXISTS idx_ocr_corrections_field
    ON ocr_field_corrections(module_name, document_type, field_name);

CREATE INDEX IF NOT EXISTS idx_ocr_corrections_canonical
    ON ocr_field_corrections(module_name, document_type, is_canonical)
    WHERE is_canonical = true;

CREATE INDEX IF NOT EXISTS idx_ocr_corrections_recent
    ON ocr_field_corrections(created_at DESC);

-- Table: ocr_field_definitions
-- Defines expected fields for each document type (for validation and prompt building)
CREATE TABLE IF NOT EXISTS ocr_field_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    module_name VARCHAR(100) NOT NULL,
    document_type VARCHAR(100) NOT NULL,
    field_name VARCHAR(100) NOT NULL,

    -- Field metadata
    display_label VARCHAR(255) NOT NULL,
    field_description TEXT,
    expected_format VARCHAR(255), -- e.g., 'YYMMDD', 'XX XX XX GP', 'numeric'
    validation_regex VARCHAR(500),
    is_required BOOLEAN DEFAULT false,

    -- Prompt hints for VLM
    extraction_hints TEXT, -- e.g., "Usually found at top of document", "13-digit number"
    common_mistakes TEXT, -- e.g., "Often confuses O with 0"

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(module_name, document_type, field_name)
);

-- Insert common field definitions for staff documents
INSERT INTO ocr_field_definitions (module_name, document_type, field_name, display_label, expected_format, extraction_hints, common_mistakes) VALUES
-- SA ID
('staff_documents', 'sa_id', 'saIdNumber', 'SA ID Number', '13 digits', 'Located at top of ID, 13-digit number starting with birth date', 'May confuse 0/O, 1/I'),
('staff_documents', 'sa_id', 'surname', 'Surname', 'text', 'Below photo on green ID', NULL),
('staff_documents', 'sa_id', 'firstName', 'First Names', 'text', 'Below surname', NULL),
('staff_documents', 'sa_id', 'dateOfBirth', 'Date of Birth', 'YYYY-MM-DD', 'First 6 digits of ID number encode YYMMDD', 'Year prefix 19/20 ambiguity'),
('staff_documents', 'sa_id', 'gender', 'Gender', 'M/F', 'Derived from ID number digits 7-10', NULL),
('staff_documents', 'sa_id', 'citizenship', 'Citizenship', 'SA Citizen/Permanent Resident', 'Digit 11 of ID: 0=SA Citizen, 1=Permanent Resident', NULL),

-- Passport
('staff_documents', 'passport', 'passportNumber', 'Passport Number', 'alphanumeric', 'Top right of bio page', 'May confuse similar letters/numbers'),
('staff_documents', 'passport', 'surname', 'Surname', 'text', 'After "Surname" label', NULL),
('staff_documents', 'passport', 'firstName', 'Given Names', 'text', 'After "Given names" label', NULL),
('staff_documents', 'passport', 'dateOfBirth', 'Date of Birth', 'DD MMM YYYY', 'Standard passport date format', NULL),
('staff_documents', 'passport', 'expiryDate', 'Expiry Date', 'DD MMM YYYY', 'Date of expiry field', NULL),
('staff_documents', 'passport', 'nationality', 'Nationality', 'text', 'Country name', NULL),

-- Driver's License
('staff_documents', 'drivers_license', 'licenseNumber', 'License Number', 'alphanumeric', 'Front of card, usually starts with province code', NULL),
('staff_documents', 'drivers_license', 'surname', 'Surname', 'text', 'On front of card', NULL),
('staff_documents', 'drivers_license', 'firstName', 'First Names', 'text', 'On front of card', NULL),
('staff_documents', 'drivers_license', 'dateOfBirth', 'Date of Birth', 'YYYY-MM-DD', 'DOB field', NULL),
('staff_documents', 'drivers_license', 'expiryDate', 'Expiry Date', 'YYYY-MM-DD', 'Valid until date', NULL),
('staff_documents', 'drivers_license', 'vehicleClasses', 'Vehicle Classes', 'codes', 'License codes like A, B, C, EB', NULL),
('staff_documents', 'drivers_license', 'idNumber', 'ID Number', '13 digits', 'SA ID number on license', NULL),

-- Bank Confirmation
('staff_documents', 'bank_confirmation', 'accountNumber', 'Account Number', 'numeric', 'Bank account number', 'May have spaces or dashes'),
('staff_documents', 'bank_confirmation', 'accountHolder', 'Account Holder', 'text', 'Name on account', NULL),
('staff_documents', 'bank_confirmation', 'bankName', 'Bank Name', 'text', 'Name of bank', NULL),
('staff_documents', 'bank_confirmation', 'branchCode', 'Branch Code', '6 digits', 'Universal branch code', NULL),
('staff_documents', 'bank_confirmation', 'accountType', 'Account Type', 'text', 'Savings/Cheque/Current', NULL)
ON CONFLICT (module_name, document_type, field_name) DO NOTHING;

-- Insert field definitions for fleet check-in
INSERT INTO ocr_field_definitions (module_name, document_type, field_name, display_label, expected_format, extraction_hints, common_mistakes) VALUES
('fleet_checkin', 'license_plate', 'registration', 'Registration Number', 'XX 00 XX GP', 'South African plate format: letters, numbers, letters, province', 'Province codes: GP, WC, KZN, etc.'),
('fleet_checkin', 'odometer', 'reading', 'Odometer Reading', 'numeric', 'Digital or analog display, usually 5-6 digits', 'May miss leading zeros, confuse 6/8'),
('fleet_checkin', 'fuel_gauge', 'level', 'Fuel Level', 'fraction or percentage', 'E to F, 0-100%, or 1/4, 1/2, 3/4', 'Analog gauges may be ambiguous')
ON CONFLICT (module_name, document_type, field_name) DO NOTHING;

-- View for few-shot example selection
CREATE OR REPLACE VIEW v_ocr_fewshot_examples AS
SELECT
    id,
    module_name,
    document_type,
    field_name,
    vlm_extracted_value,
    corrected_value,
    image_description,
    vlm_confidence,
    correction_reason,
    is_canonical,
    reviewed_count,
    created_at
FROM ocr_field_corrections
WHERE corrected_value IS NOT NULL
  AND corrected_value != ''
  AND (vlm_extracted_value IS NULL OR vlm_extracted_value != corrected_value)
ORDER BY
    is_canonical DESC,
    reviewed_count DESC,
    vlm_confidence DESC,
    created_at DESC;

-- Function to get few-shot examples for a specific document type
CREATE OR REPLACE FUNCTION get_ocr_fewshot_examples(
    p_module_name VARCHAR(100),
    p_document_type VARCHAR(100),
    p_field_name VARCHAR(100) DEFAULT NULL,
    p_max_examples INTEGER DEFAULT 5
)
RETURNS TABLE (
    field_name VARCHAR(100),
    vlm_extracted_value TEXT,
    corrected_value TEXT,
    image_description TEXT,
    correction_reason TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ofc.field_name,
        ofc.vlm_extracted_value,
        ofc.corrected_value,
        ofc.image_description,
        ofc.correction_reason
    FROM ocr_field_corrections ofc
    WHERE ofc.module_name = p_module_name
      AND ofc.document_type = p_document_type
      AND (p_field_name IS NULL OR ofc.field_name = p_field_name)
      AND ofc.corrected_value IS NOT NULL
      AND ofc.corrected_value != ''
    ORDER BY
        ofc.is_canonical DESC,
        ofc.reviewed_count DESC,
        ofc.vlm_confidence DESC NULLS LAST,
        ofc.created_at DESC
    LIMIT p_max_examples;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON TABLE ocr_field_corrections IS 'HITL few-shot learning: stores human corrections to VLM OCR extractions for prompt enhancement';
COMMENT ON TABLE ocr_field_definitions IS 'Field metadata for OCR extraction - validation rules and prompt hints';
