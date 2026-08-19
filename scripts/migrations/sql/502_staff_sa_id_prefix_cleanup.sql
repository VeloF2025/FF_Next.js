-- 502: strip the corrupted import prefix from staff.sa_id_number
--
-- Ten staff rows carry junk in front of the real ID from a legacy payroll
-- import — usually "02" or "02/", once a stray leading digit. A South African
-- ID is always exactly 13 digits (YYMMDD SSSS C A Z), so these are corrupt,
-- not long-but-valid.
--
-- The damage is not cosmetic: the staff edit form mirrors sa_id_number into
-- id_number (varchar(13)), so saving ANY field on these rows fails with
-- Postgres 22001 and the UI shows a bare "HTTP 500". They cannot be edited at
-- all until this is cleaned.
--
-- A row is repaired only when its trailing 13 characters are a VALID SA ID —
-- correct shape, plausible date of birth, correct Luhn check digit. Matching on
-- the check digit rather than on the shape of the prefix means the migration
-- cannot quietly produce a well-formed but WRONG ID: a value whose junk is
-- trailing, or that is short behind its prefix, simply fails the test and is
-- left for a human. The values are never listed literally — an ID number is
-- POPIA-protected personal information and, unlike a credential, cannot be
-- rotated once it is in git history. The pre-image goes to a backup table so
-- the rollback is a true inverse without publishing anything.
--
-- Rows whose sa_id_number is invalid for other reasons (letters, wrong length,
-- failed check digit) cannot be derived from the stored value and need the
-- physical document. They are reported as a NOTICE, not repaired.

-- Session-local: disappears with the connection, nothing to clean up.
CREATE OR REPLACE FUNCTION pg_temp.is_valid_sa_id(v text) RETURNS boolean AS $fn$
DECLARE
  total int := 0;
  digit int;
  i int;
  place int := 0;
BEGIN
  IF v !~ '^[0-9]{13}$' THEN RETURN false; END IF;
  -- Date of birth: month 01-12, day 01-31.
  IF substring(v, 3, 2)::int NOT BETWEEN 1 AND 12 THEN RETURN false; END IF;
  IF substring(v, 5, 2)::int NOT BETWEEN 1 AND 31 THEN RETURN false; END IF;
  -- Luhn over all 13 digits, doubling every second digit from the right.
  FOR i IN REVERSE 13..1 LOOP
    digit := substring(v, i, 1)::int;
    IF place % 2 = 1 THEN
      digit := digit * 2;
      IF digit > 9 THEN digit := digit - 9; END IF;
    END IF;
    total := total + digit;
    place := place + 1;
  END LOOP;
  RETURN total % 10 = 0;
END;
$fn$ LANGUAGE plpgsql IMMUTABLE;

CREATE TABLE IF NOT EXISTS staff_sa_id_prefix_backup_502 (
  staff_id      uuid PRIMARY KEY,
  sa_id_number  text NOT NULL,
  backed_up_at  timestamptz NOT NULL DEFAULT NOW()
);

INSERT INTO staff_sa_id_prefix_backup_502 (staff_id, sa_id_number)
SELECT id, sa_id_number
  FROM staff
 WHERE length(sa_id_number) > 13
   AND pg_temp.is_valid_sa_id(right(sa_id_number, 13))
ON CONFLICT (staff_id) DO NOTHING;

UPDATE staff
   SET sa_id_number = right(sa_id_number, 13),
       updated_at = NOW()
 WHERE length(sa_id_number) > 13
   AND pg_temp.is_valid_sa_id(right(sa_id_number, 13));

DO $$
DECLARE
  repaired int;
  still_bad int;
  untouched int;
BEGIN
  -- Every repaired row must now hold a valid 13-digit ID. Scoped to the rows
  -- this migration actually touched, so a row it deliberately leaves alone
  -- cannot fail the deploy.
  SELECT count(*) INTO repaired FROM staff_sa_id_prefix_backup_502;
  SELECT count(*) INTO still_bad
    FROM staff s
    JOIN staff_sa_id_prefix_backup_502 b ON b.staff_id = s.id
   WHERE NOT pg_temp.is_valid_sa_id(s.sa_id_number);
  IF still_bad > 0 THEN
    RAISE EXCEPTION 'migration 502: % repaired row(s) do not hold a valid 13-digit SA ID', still_bad;
  END IF;
  -- Ten rows were identified and their replacements individually check-digit
  -- verified before this migration was written. If the count differs at apply
  -- time the data moved underneath that verification — a row was corrected by
  -- hand, or an eleventh corrupt row appeared — and the migration must stop so
  -- a human can re-verify rather than write unreviewed values to staff records.
  IF repaired <> 10 THEN
    RAISE EXCEPTION 'migration 502: expected 10 repairable row(s), found % — re-verify the affected IDs before applying', repaired;
  END IF;
  RAISE NOTICE 'migration 502: repaired % row(s)', repaired;

  -- Anything still over-length is beyond this migration's reach: it will keep
  -- failing to save until someone supplies the real document.
  SELECT count(*) INTO untouched FROM staff WHERE length(sa_id_number) > 13;
  IF untouched > 0 THEN
    RAISE NOTICE 'migration 502: % row(s) still exceed 13 characters and need the physical document', untouched;
  END IF;
END $$;
