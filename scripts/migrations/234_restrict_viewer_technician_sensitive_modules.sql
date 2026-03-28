-- =====================================================
-- Migration 234: Restrict viewer & technician roles from sensitive modules
-- Removes access to: accounting, system, people, procurement,
--   analytics, communications, noc, sow, contractors
-- Keeps: dashboard, projects, activate, field, field-ops,
--   construction-qa, fleet, assets, maintenance, help-center, clients
-- =====================================================

-- Viewer role: remove all sensitive module permissions
DELETE FROM role_permissions
WHERE role = 'viewer'
  AND (
    permission_key = 'accounting' OR permission_key LIKE 'accounting.%'
    OR permission_key = 'system' OR permission_key LIKE 'system.%'
    OR permission_key = 'people' OR permission_key LIKE 'people.%'
    OR permission_key = 'procurement' OR permission_key LIKE 'procurement.%'
    OR permission_key = 'analytics' OR permission_key LIKE 'analytics.%'
    OR permission_key = 'communications' OR permission_key LIKE 'communications.%'
    OR permission_key = 'noc' OR permission_key LIKE 'noc.%'
    OR permission_key = 'sow' OR permission_key LIKE 'sow.%'
    OR permission_key = 'contractors' OR permission_key LIKE 'contractors.%'
  );

-- Technician role: remove all sensitive module permissions
DELETE FROM role_permissions
WHERE role = 'technician'
  AND (
    permission_key = 'accounting' OR permission_key LIKE 'accounting.%'
    OR permission_key = 'system' OR permission_key LIKE 'system.%'
    OR permission_key = 'people' OR permission_key LIKE 'people.%'
    OR permission_key = 'procurement' OR permission_key LIKE 'procurement.%'
    OR permission_key = 'analytics' OR permission_key LIKE 'analytics.%'
    OR permission_key = 'communications' OR permission_key LIKE 'communications.%'
    OR permission_key = 'noc' OR permission_key LIKE 'noc.%'
    OR permission_key = 'sow' OR permission_key LIKE 'sow.%'
    OR permission_key = 'contractors' OR permission_key LIKE 'contractors.%'
  );
