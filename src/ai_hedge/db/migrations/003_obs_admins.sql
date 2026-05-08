-- Admin allowlist for the standalone observability app (frontend-obs).
-- Apply against the same database that holds obs_runs / obs_calls
-- (typically OBS_DATABASE_URL; falls back to DATABASE_URL_UNPOOLED / DATABASE_URL).

CREATE TABLE IF NOT EXISTS obs_admins (
    email      text PRIMARY KEY,
    added_by   text,                                  -- email of the admin who added this row; NULL for seeds
    added_at   timestamptz NOT NULL DEFAULT now(),
    is_super   boolean NOT NULL DEFAULT false         -- super admins can remove other super admins
);

-- Seed the bootstrap admin: yonash8 only. Other admins are added from /users.
INSERT INTO obs_admins (email, added_by, is_super) VALUES
    ('yonash8@gmail.com', NULL, true)
ON CONFLICT (email) DO NOTHING;
