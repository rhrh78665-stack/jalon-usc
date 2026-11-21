import { PGlite } from '@electric-sql/pglite'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function openDatabase(path) {
    if (path) await mkdir(dirname(path), { recursive: true })
    const db = new PGlite(path)
    await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      email text NOT NULL UNIQUE,
      password text NOT NULL,
      status text NOT NULL CHECK(status IN ('pending', 'approved', 'rejected'))
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS alias text NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS trip_email_opt_in boolean NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

    CREATE TABLE IF NOT EXISTS account_links (
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose text NOT NULL CHECK (purpose IN ('recover', 'verify')),
      token_hash text NOT NULL UNIQUE,
      issued_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at timestamptz NOT NULL,
      PRIMARY KEY (user_id, purpose)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS mobility boolean NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS roster (
      code text PRIMARY KEY,
      role text NOT NULL CHECK (role IN ('estudiante', 'docente', 'administrativo'))
    );

    INSERT INTO roster (code, role) VALUES
      ('20260001', 'estudiante'),
      ('20260002', 'docente'),
      ('20260003', 'administrativo')
    ON CONFLICT (code) DO NOTHING;

    CREATE TABLE IF NOT EXISTS membership_reviews (
      user_id text PRIMARY KEY REFERENCES users(id),
      reviewer_id text NOT NULL REFERENCES users(id),
      code text NOT NULL,
      declared_role text NOT NULL CHECK (declared_role IN ('estudiante', 'docente', 'administrativo')),
      decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
      reviewed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS approved_membership_code
      ON membership_reviews (code) WHERE decision = 'approved';

    CREATE TABLE IF NOT EXISTS driver_permissions (
      user_id text PRIMARY KEY REFERENCES users(id),
      reviewer_id text NOT NULL REFERENCES users(id),
      license_expires_on date NOT NULL,
      enabled_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id),
      plate text NOT NULL UNIQUE CHECK (plate ~ '^[A-Z]{3}[0-9]{3}$'),
      seats integer NOT NULL CHECK (seats > 0),
      efficiency double precision NOT NULL CHECK (
        efficiency > 0 AND efficiency < 'Infinity'::double precision
      )
    );

    CREATE INDEX IF NOT EXISTS vehicles_user_id_idx ON vehicles (user_id);
  `)
    return db
}