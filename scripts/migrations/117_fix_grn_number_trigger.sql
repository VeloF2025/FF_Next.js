-- Migration 117: Fix GRN Number Trigger
-- Issue: SUBSTRING(grn_number FROM 6) extracted "-00001" instead of "00001"
--        causing duplicate GRN numbers when syncing from Odoo
-- Fix: Changed to SUBSTRING(grn_number FROM 7) to correctly extract the numeric portion

-- Drop and recreate the trigger function with correct SUBSTRING position
CREATE OR REPLACE FUNCTION public.generate_grn_number()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    year_suffix VARCHAR(2);
    next_num INTEGER;
    prefix VARCHAR(10);
BEGIN
    IF NEW.grn_number IS NULL OR NEW.grn_number = '' THEN
        year_suffix := TO_CHAR(NOW(), 'YY');
        prefix := 'GRN' || year_suffix || '-';

        -- Extract number after 'GRN26-' (7 characters), e.g., '00001' from 'GRN26-00001'
        -- Previously used FROM 6 which included the dash, causing cast to return -1
        SELECT COALESCE(MAX(
            CAST(SUBSTRING(grn_number FROM 7) AS INTEGER)
        ), 0) + 1 INTO next_num
        FROM goods_receipt_notes
        WHERE grn_number LIKE prefix || '%';

        NEW.grn_number := prefix || LPAD(next_num::TEXT, 5, '0');
    END IF;
    RETURN NEW;
END;
$function$;

-- Verify trigger is attached
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'tr_grn_number'
        AND tgrelid = 'goods_receipt_notes'::regclass
    ) THEN
        CREATE TRIGGER tr_grn_number
            BEFORE INSERT ON goods_receipt_notes
            FOR EACH ROW
            EXECUTE FUNCTION generate_grn_number();
    END IF;
END $$;
