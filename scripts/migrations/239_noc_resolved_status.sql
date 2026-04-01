-- Migration 239: Update 'resolved' status for team lead approval workflow
-- Flow: technician marks as resolved → team lead reviews and closes

UPDATE maintenance_statuses
SET description = 'Work completed, pending team lead approval to close',
    updated_at = NOW()
WHERE code = 'resolved';
