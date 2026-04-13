-- Migration 302: Grant can_impersonate permission to Hein and Zander
-- This is a one-time setup — only these two users should ever have this permission
-- Created: 2026-04-13

UPDATE users
SET permissions = (
  CASE
    WHEN permissions @> '["can_impersonate"]'::jsonb THEN permissions
    ELSE permissions || '["can_impersonate"]'::jsonb
  END
)
WHERE email IN ('hein@velocityfibre.co.za', 'zander@velocityfibre.co.za');
