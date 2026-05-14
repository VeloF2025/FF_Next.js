-- Session-actor identity capture for the public /snag/resolve/[token] link.
--
-- The link is anonymous: anyone who has the URL can interact. To establish
-- accountability for who said/did what, we capture a name + WhatsApp number
-- + (optional) company per browser session and reference the resulting
-- actor_id on every step completion, photo upload, and (future) comment.
--
-- The browser_fingerprint is the dedup key — same browser + same token
-- returns the same actor_id on subsequent interactions, so a re-opened tab
-- on the same device doesn't re-prompt.

CREATE TABLE IF NOT EXISTS share_session_actors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token               text NOT NULL,
  browser_fingerprint text NOT NULL,
  name                text NOT NULL,
  phone               text NOT NULL,
  company             text,
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now()
);

-- One actor per (token, fingerprint). UPSERT on register_actor uses this.
CREATE UNIQUE INDEX IF NOT EXISTS idx_share_session_actors_token_fp
  ON share_session_actors (token, browser_fingerprint);

CREATE INDEX IF NOT EXISTS idx_share_session_actors_token
  ON share_session_actors (token);

-- Foreign-key style guard via trigger would be circular (snag_share_tokens
-- ownership is not in this PR's scope). Application code validates the
-- token exists before inserting.

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
