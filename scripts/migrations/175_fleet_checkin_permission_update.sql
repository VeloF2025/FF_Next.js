-- Update fleet check-in permission to reflect merged Check-Ins page
-- Old: "Check-in Audit" at /fleet/check-in/audit (page was merged into history)
-- New: "Check-Ins" at /fleet/check-in/history

UPDATE access_permissions
SET label = 'Check-Ins',
    route = '/fleet/check-in/history'
WHERE key = 'fleet.check-in-audit';
