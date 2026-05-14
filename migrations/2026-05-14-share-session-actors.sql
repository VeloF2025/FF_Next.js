-- Session-actor identity capture for the public /snag/resolve/[token] link.
--
-- The link is anonymous: anyone who has the URL can interact. To establish
-- accountability for who said/did what, we capture a name + WhatsApp number
-- + (optional) company per browser session and reference the resulting
-- actor_id on every step completion, photo upload, and (future) comment.
--
-- Security notes:
--   - token_hash stores SHA256(raw_token), never the raw token. The actors
--     table is the obvious target for an audit-view query; without hashing
--     a leaked actors row would replay as a live share link.
--   - browser_fingerprint is the dedup key — same browser + same token
--     returns the same actor_id on subsequent interactions.
--   - char_length CHECK constraints bound the storage footprint of an
--     unauthenticated public-write endpoint.

CREATE TABLE IF NOT EXISTS share_session_actors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash          text NOT NULL CHECK (char_length(token_hash) = 64),
  browser_fingerprint text NOT NULL CHECK (char_length(browser_fingerprint) BETWEEN 1 AND 128),
  name                text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  phone               text NOT NULL CHECK (char_length(phone) BETWEEN 1 AND 50),
  company             text          CHECK (company IS NULL OR char_length(company) <= 200),
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now()
);

-- One actor per (token_hash, fingerprint). UPSERT on register_actor uses this.
CREATE UNIQUE INDEX IF NOT EXISTS idx_share_session_actors_token_fp
  ON share_session_actors (token_hash, browser_fingerprint);

CREATE INDEX IF NOT EXISTS idx_share_session_actors_token_hash
  ON share_session_actors (token_hash);

-- Stamp every step completion with the actor who completed it.
ALTER TABLE maintenance_verification_steps
  ADD COLUMN IF NOT EXISTS completed_by_actor_id uuid REFERENCES share_session_actors(id);

-- Stamp every attachment (after-photo, evidence) with the uploading actor.
-- The resolve page writes after-photos to maintenance_attachments, not
-- snag_photos (snag_photos holds the before-photos uploaded by office staff).
ALTER TABLE maintenance_attachments
  ADD COLUMN IF NOT EXISTS uploaded_by_actor_id uuid REFERENCES share_session_actors(id);

-- Indexes for lookup-by-actor (audit / report queries).
CREATE INDEX IF NOT EXISTS idx_maintenance_verification_steps_actor
  ON maintenance_verification_steps (completed_by_actor_id)
  WHERE completed_by_actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_maintenance_attachments_actor
  ON maintenance_attachments (uploaded_by_actor_id)
  WHERE uploaded_by_actor_id IS NOT NULL;
