-- Migration 216: Stock code & category cleanup
-- 1. Merge optical → optics
-- 2. Replace stock_categories with clean set matching stock_items.category values

BEGIN;

-- 1a. Merge optical → optics (11 items affected)
UPDATE stock_items SET category = 'optics' WHERE category = 'optical';

-- 1b. Delete old system categories
DELETE FROM stock_categories;

-- 1c. Insert new 14 categories (7 primary from rate card + 7 extra)
INSERT INTO stock_categories (code, name, icon, color, sort_order, is_system, is_active, level, path)
VALUES
  -- Primary 7 (from supplier rate card)
  ('activations', 'Activations',  'plug',         'green',  1, true, true, 1, '/activations/'),
  ('tools',       'Tools',        'wrench',       'orange', 2, true, true, 1, '/tools/'),
  ('optics',      'Optics',       'eye',          'purple', 3, true, true, 1, '/optics/'),
  ('stringing',   'Stringing',    'cable',        'blue',   4, true, true, 1, '/stringing/'),
  ('consumable',  'Consumable',   'package',      'gray',   5, true, true, 1, '/consumable/'),
  ('poles',       'Poles',        'utility-pole', 'yellow', 6, true, true, 1, '/poles/'),
  ('backhaul',    'Backhaul',     'network',      'cyan',   7, true, true, 1, '/backhaul/'),
  -- Extra 7 (non-spreadsheet items)
  ('fibertime',     'Fibertime',     NULL, NULL, 8,  false, true, 1, '/fibertime/'),
  ('services',      'Services',      NULL, NULL, 9,  false, true, 1, '/services/'),
  ('goods',         'Goods',         NULL, NULL, 10, false, true, 1, '/goods/'),
  ('expenses',      'Expenses',      NULL, NULL, 11, false, true, 1, '/expenses/'),
  ('mechanical',    'Mechanical',    NULL, NULL, 12, false, true, 1, '/mechanical/'),
  ('boq',           'BOQ',           NULL, NULL, 13, false, true, 1, '/boq/'),
  ('uncategorized', 'Uncategorized', NULL, NULL, 14, false, true, 1, '/uncategorized/');

COMMIT;
