-- Migration 443: FNO Atlas Letaba Networks operator
-- Purpose: seed Letaba Networks so their presence points can be ingested.
-- Notes:
--   * Additive only. Mirrors the operator seed style of migration 427.
--   * Letaba publishes no coverage map, GeoJSON, KML, WMS or WFS layer. Their
--     footprint can only be established point-by-point via their public
--     coverage-check API, so this operator carries presence points (mig 428),
--     never coverage polygons (mig 427).
--   * brand_color is Letaba's own portal theme primary (--bp-primary).

INSERT INTO fno_atlas_operators (slug, name, operator_type, website_url, brand_color, notes)
VALUES
  ('letaba', 'Letaba Networks', 'fno', 'https://letaba.net/', '#004A8F',
   'Limpopo/Mpumalanga regional ISP (Vhembe, Mopani, Ehlanzeni districts; Musina to Lydenburg). Wireless-first, plus TruFibre/SkyFibre. Publishes no coverage map — presence points only, derived from their public coverage-check API.')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  operator_type = EXCLUDED.operator_type,
  website_url = EXCLUDED.website_url,
  brand_color = EXCLUDED.brand_color,
  notes = EXCLUDED.notes,
  updated_at = NOW();
