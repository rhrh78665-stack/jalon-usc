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

    CREATE TABLE IF NOT EXISTS trips (
      id text PRIMARY KEY,
      driver_id text NOT NULL REFERENCES users(id),
      vehicle_id text NOT NULL REFERENCES vehicles(id),
      depart_at timestamptz NOT NULL,
      capacity integer NOT NULL CHECK (capacity > 0),
      route jsonb NOT NULL,
      status text NOT NULL DEFAULT 'Programado'
        CHECK (status IN ('Programado', 'Lleno', 'EnCurso', 'Completado', 'Cancelado'))
    );

    CREATE INDEX IF NOT EXISTS trips_driver_depart_idx ON trips (driver_id, depart_at);

    ALTER TABLE trips ADD COLUMN IF NOT EXISTS itinerary jsonb NOT NULL DEFAULT '[]';
    ALTER TABLE trips ADD COLUMN IF NOT EXISTS pricing jsonb;
    ALTER TABLE trips ADD COLUMN IF NOT EXISTS cancel_reason text;

    ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until timestamptz;

    CREATE TABLE IF NOT EXISTS reservations (
      id text PRIMARY KEY,
      trip_id text NOT NULL REFERENCES trips(id),
      passenger_id text NOT NULL REFERENCES users(id),
      board_index integer NOT NULL CHECK (board_index >= 0),
      alight_index integer NOT NULL CHECK (alight_index > board_index),
      status text NOT NULL DEFAULT 'Pendiente'
        CHECK (status IN ('Pendiente', 'Confirmada', 'Rechazada', 'Cancelada', 'Vencida')),
      maximum_cop integer NOT NULL CHECK (maximum_cop >= 0)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS reservations_active_passenger_idx
      ON reservations (trip_id, passenger_id) WHERE status IN ('Pendiente', 'Confirmada');
    CREATE INDEX IF NOT EXISTS reservations_trip_status_idx ON reservations (trip_id, status);
    ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancelled_by_passenger boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS booking_warnings (
      reservation_id text NOT NULL REFERENCES reservations(id),
      passenger_id text NOT NULL REFERENCES users(id),
      reason text NOT NULL CHECK (reason IN ('cancelacion_tardia', 'ausencia')),
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (reservation_id, reason)
    );
    CREATE INDEX IF NOT EXISTS booking_warnings_passenger_date ON booking_warnings(passenger_id, created_at);
    ALTER TABLE trips ADD COLUMN IF NOT EXISTS started_at timestamptz;
    ALTER TABLE trips ADD COLUMN IF NOT EXISTS completed_at timestamptz;
    ALTER TABLE trips ADD COLUMN IF NOT EXISTS liquidation jsonb;
    ALTER TABLE reservations ADD COLUMN IF NOT EXISTS attendance text CHECK (attendance IN ('Abordo', 'Ausente'));
    ALTER TABLE reservations ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
    CREATE TABLE IF NOT EXISTS compensations (
      reservation_id text PRIMARY KEY REFERENCES reservations(id),
      amount_cop integer NOT NULL CHECK (amount_cop > 0),
      recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      confirmed_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS trip_tariffs (
      version integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      fuel_price integer NOT NULL CHECK (fuel_price > 0),
      tolls jsonb NOT NULL,
      configured_by text NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ratings (
      trip_id text NOT NULL REFERENCES trips(id),
      author_id text NOT NULL REFERENCES users(id),
      target_id text NOT NULL REFERENCES users(id),
      stars integer NOT NULL CHECK (stars BETWEEN 1 AND 5),
      review text NOT NULL CHECK (char_length(review) BETWEEN 1 AND 300),
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (author_id <> target_id),
      PRIMARY KEY (trip_id, author_id, target_id)
    );
  `)
    return db
}
