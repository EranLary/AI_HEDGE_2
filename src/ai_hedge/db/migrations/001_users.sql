CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    google_sub    text NOT NULL UNIQUE,
    email         text NOT NULL UNIQUE,
    name          text,
    image_url     text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reports
    DROP CONSTRAINT IF EXISTS reports_user_id_fkey,
    ADD  CONSTRAINT reports_user_id_fkey
         FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
