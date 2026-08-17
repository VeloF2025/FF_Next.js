-- scripts/migrations/sql/495_physical_stock_snapshots.sql
-- Historical physical stock-take snapshots imported from Lizelle's weekly
-- "Site Stock Take" workbook (SharePoint). These are a READ-ONLY historical
-- reference record of the physically-counted on-hand per site per item over
-- time — deliberately SEPARATE from the operational stock_takes /
-- stock_take_lines tables and from stock_quants, so backfilling months of
-- history never touches live stock levels or the count/approve workflow.
--
-- One row per (snapshot_date, source_tab, site_label, item_code). warehouse_id
-- is the mapped FF location when the site has one (NULL for sites with no FF
-- warehouse yet, e.g. Phalaborwa / Mafikeng). Value columns are the sheet's own
-- unit price at the time of the count, not FF standard_cost.

CREATE TABLE IF NOT EXISTS physical_stock_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  snapshot_date   DATE        NOT NULL,
  source_tab      TEXT        NOT NULL,
  site_label      TEXT        NOT NULL,
  warehouse_id    UUID        REFERENCES stock_locations(id),
  warehouse_code  TEXT,
  item_code       TEXT        NOT NULL,
  item_name       TEXT,
  category        TEXT,
  quantity        NUMERIC     NOT NULL,
  unit_cost       NUMERIC,
  line_value      NUMERIC,
  in_ff_catalog   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_physical_stock_snapshot
  ON physical_stock_snapshots (snapshot_date, source_tab, site_label, item_code);

CREATE INDEX IF NOT EXISTS idx_physical_snapshot_date
  ON physical_stock_snapshots (snapshot_date);

CREATE INDEX IF NOT EXISTS idx_physical_snapshot_item
  ON physical_stock_snapshots (item_code);

CREATE INDEX IF NOT EXISTS idx_physical_snapshot_warehouse
  ON physical_stock_snapshots (warehouse_code);

COMMENT ON TABLE physical_stock_snapshots IS
  'Historical physical stock-take counts from the weekly SharePoint workbook. Reference-only; never mutates stock_quants. Backfilled by scripts/import-physical-stock-snapshots.mjs.';
