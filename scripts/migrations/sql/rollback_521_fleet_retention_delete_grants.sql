-- rollback_521_fleet_retention_delete_grants.sql
--
-- Reverses 521_fleet_retention_delete_grants.sql, returning the seven
-- programme-owned PR4-7 Fleet incident tables to append-only at the permission
-- level: the application keeps SELECT/INSERT (and UPDATE where it had it) and
-- loses the ability to delete any of them.
--
-- The descriptor after the number is identical to the forward file's on
-- purpose. A rollback whose name does not match its migration is how the wrong
-- rollback gets applied silently.
--
-- After this runs, the retention pipeline can no longer purge: a live run
-- fails with `permission denied for table ...` on the first child delete, and
-- POPIA erasure through the application becomes impossible again. That is the
-- intended state of a rollback, not a side effect — but it is not a quiet one,
-- so schedule it knowingly.
--
-- No incident data is deleted, altered, or exposed by this file. REVOKE only
-- removes a privilege; it never touches a row. Like GRANT, it is repeatable:
-- revoking a privilege the role does not hold is a no-op.

REVOKE DELETE ON
  fleet_operational_incidents,
  fleet_operational_incident_observations,
  fleet_operational_incident_actions,
  fleet_operational_incident_evidence,
  fleet_incident_driver_input_requests,
  fleet_incident_driver_submissions,
  fleet_incident_attendance_correction_links
FROM fibreflow_user;
