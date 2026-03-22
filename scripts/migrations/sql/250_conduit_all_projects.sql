-- Migration 250: Add remaining 8 Conduit projects
-- Lawley (a1b2c3d4-0000-4000-8000-000000000001) already exists — skip

INSERT INTO conduit_projects (id, name, po_count, build_duration_months, inputs_json)
VALUES
  (
    'b2c3d4e5-0000-4000-8000-000000000002',
    'Mohadin',
    22434,
    12,
    '{"rate":2700,"uptake":0.52,"scope":{"poles":0,"stringing_m":0,"pon":0},"service_rates":{"permissions_per_pole":0,"poles_each":0,"stringing_per_m":0,"optical_per_pon":0,"activation_each":155},"stock_rates":{"pole":0,"cable_per_m":0,"optical":0,"activation":191.68},"expenses_per_month":{"ad_hoc":0,"casuals":0,"fuel":0,"overheads":0,"sales":0}}'::jsonb
  ),
  (
    'c3d4e5f6-0000-4000-8000-000000000003',
    'Mamelodi POP 1 - Phase 1',
    8305,
    12,
    '{"rate":2700,"uptake":0.60,"scope":{"poles":0,"stringing_m":0,"pon":0},"service_rates":{"permissions_per_pole":0,"poles_each":0,"stringing_per_m":0,"optical_per_pon":0,"activation_each":155},"stock_rates":{"pole":0,"cable_per_m":0,"optical":0,"activation":191.68},"expenses_per_month":{"ad_hoc":0,"casuals":0,"fuel":0,"overheads":0,"sales":0}}'::jsonb
  ),
  (
    'd4e5f6a7-0000-4000-8000-000000000004',
    'Etwatwa POP 2',
    9042,
    10,
    '{"rate":2700,"uptake":0.60,"scope":{"poles":0,"stringing_m":0,"pon":0},"service_rates":{"permissions_per_pole":0,"poles_each":0,"stringing_per_m":0,"optical_per_pon":0,"activation_each":155},"stock_rates":{"pole":0,"cable_per_m":0,"optical":0,"activation":191.68},"expenses_per_month":{"ad_hoc":0,"casuals":0,"fuel":0,"overheads":0,"sales":0}}'::jsonb
  ),
  (
    'e5f6a7b8-0000-4000-8000-000000000005',
    'Thembisa POP 1 (P1/2)',
    30816,
    10,
    '{"rate":2700,"uptake":0.60,"scope":{"poles":0,"stringing_m":0,"pon":0},"service_rates":{"permissions_per_pole":0,"poles_each":0,"stringing_per_m":0,"optical_per_pon":0,"activation_each":155},"stock_rates":{"pole":0,"cable_per_m":0,"optical":0,"activation":191.68},"expenses_per_month":{"ad_hoc":0,"casuals":0,"fuel":0,"overheads":0,"sales":0}}'::jsonb
  ),
  (
    'f6a7b8c9-0000-4000-8000-000000000006',
    'Thembisa POP 2 (P1/2)',
    30127,
    10,
    '{"rate":2700,"uptake":0.60,"scope":{"poles":0,"stringing_m":0,"pon":0},"service_rates":{"permissions_per_pole":0,"poles_each":0,"stringing_per_m":0,"optical_per_pon":0,"activation_each":155},"stock_rates":{"pole":0,"cable_per_m":0,"optical":0,"activation":191.68},"expenses_per_month":{"ad_hoc":0,"casuals":0,"fuel":0,"overheads":0,"sales":0}}'::jsonb
  ),
  (
    'a7b8c9d0-0000-4000-8000-000000000007',
    'Thembisa POP 3 (P1/2)',
    38367,
    10,
    '{"rate":2700,"uptake":0.60,"scope":{"poles":0,"stringing_m":0,"pon":0},"service_rates":{"permissions_per_pole":0,"poles_each":0,"stringing_per_m":0,"optical_per_pon":0,"activation_each":155},"stock_rates":{"pole":0,"cable_per_m":0,"optical":0,"activation":191.68},"expenses_per_month":{"ad_hoc":0,"casuals":0,"fuel":0,"overheads":0,"sales":0}}'::jsonb
  ),
  (
    'b8c9d0e1-0000-4000-8000-000000000008',
    'Themb''elihle',
    10403,
    10,
    '{"rate":2700,"uptake":0.50,"scope":{"poles":0,"stringing_m":0,"pon":0},"service_rates":{"permissions_per_pole":0,"poles_each":0,"stringing_per_m":0,"optical_per_pon":0,"activation_each":155},"stock_rates":{"pole":0,"cable_per_m":0,"optical":0,"activation":191.68},"expenses_per_month":{"ad_hoc":0,"casuals":0,"fuel":0,"overheads":0,"sales":0}}'::jsonb
  ),
  (
    'c9d0e1f2-0000-4000-8000-000000000009',
    'Tonga',
    4093,
    10,
    '{"rate":2450,"uptake":1.00,"scope":{"poles":0,"stringing_m":0,"pon":0},"service_rates":{"permissions_per_pole":0,"poles_each":0,"stringing_per_m":0,"optical_per_pon":0,"activation_each":155},"stock_rates":{"pole":0,"cable_per_m":0,"optical":0,"activation":191.68},"expenses_per_month":{"ad_hoc":0,"casuals":0,"fuel":0,"overheads":0,"sales":0}}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;
