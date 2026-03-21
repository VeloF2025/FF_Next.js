-- Migration 251: Conduit inputs_json schema v2
-- Replaces over-engineered service_rates + stock_rates split with
-- PM-centric unit_costs + monthly_opex + lump_costs.
--
-- All existing projects retain rate, uptake, scope quantities.
-- All cost fields reset to 0 (to be entered by PM in Conduit).

UPDATE conduit_projects
SET inputs_json = jsonb_build_object(
  'rate',    (inputs_json->>'rate')::numeric,
  'uptake',  (inputs_json->>'uptake')::numeric,
  'scope', jsonb_build_object(
    'poles',       COALESCE((inputs_json->'scope'->>'poles')::numeric, 0),
    'stringing_m', COALESCE((inputs_json->'scope'->>'stringing_m')::numeric, 0),
    'pon',         COALESCE((inputs_json->'scope'->>'pon')::numeric, 0)
  ),
  'unit_costs', jsonb_build_object(
    'per_pole',          0,
    'per_stringing_m',   0,
    'per_pon',           0,
    'per_activation',    0,
    'wayleave_per_pole', 0
  ),
  'monthly_opex', jsonb_build_object(
    'casuals',   0,
    'fuel',      0,
    'overheads', 0,
    'sales',     0
  ),
  'lump_costs', jsonb_build_object(
    'ad_hoc',        0,
    'sub_contractor', 0
  )
);
