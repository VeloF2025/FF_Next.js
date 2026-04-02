-- Migration 241: Extend unit_price columns to 4 decimal places
-- NOC Ticket: VF-20260331-049
-- Allows users to enter prices with up to 4 decimal places (e.g. 1.2345)
--
-- Tables altered:
--   purchase_order_items   DECIMAL(12,2)  -> DECIMAL(15,4)
--   boq_items              NUMERIC(12,2)  -> NUMERIC(15,4)
--   budget_items           DECIMAL(15,2)  -> DECIMAL(15,4)
--   customer_quote_lines   NUMERIC(15,2)  -> NUMERIC(15,4)
--
-- Note: ticket referenced 'customer_quote_items' but the actual table is
-- 'customer_quote_lines' (see migration 219_customer_quotes.sql).

ALTER TABLE purchase_order_items ALTER COLUMN unit_price TYPE DECIMAL(15,4);
ALTER TABLE boq_items ALTER COLUMN unit_price TYPE NUMERIC(15,4);
ALTER TABLE budget_items ALTER COLUMN unit_price TYPE DECIMAL(15,4);
ALTER TABLE customer_quote_lines ALTER COLUMN unit_price TYPE NUMERIC(15,4);
