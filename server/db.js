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

    CREATE TABLE IF NOT EXISTS incidents (
      id text PRIMARY KEY,
      trip_id text NOT NULL REFERENCES trips(id),
      reporter_id text NOT NULL REFERENCES users(id),
      category text NOT NULL CHECK (category IN ('seguridad', 'conducta', 'vehiculo', 'otro')),
      description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 2000),
      status text NOT NULL DEFAULT 'Recibido' CHECK (status IN ('Recibido', 'Resuelto')),
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS incidents_reporter_date ON incidents(reporter_id, created_at);


    ALTER TABLE incidents ADD COLUMN IF NOT EXISTS decision text;
    ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolution text;
    ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolved_by text REFERENCES users(id);
    ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolved_at timestamptz;


    CREATE TABLE IF NOT EXISTS trip_notifications (
      event_key text NOT NULL,
      user_id text NOT NULL REFERENCES users(id),
      subject text NOT NULL,
      message text NOT NULL,
      status text NOT NULL DEFAULT 'Pendiente'
        CHECK (status IN ('Pendiente', 'Enviado', 'Omitido', 'Revisar')),
      attempts integer NOT NULL DEFAULT 0,
      first_attempt_at timestamptz,
      next_attempt_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (event_key, user_id)
    );

    ALTER TABLE trip_notifications ADD COLUMN IF NOT EXISTS locked_until timestamptz;
    ALTER TABLE trip_notifications ADD COLUMN IF NOT EXISTS lease_token text;
    CREATE OR REPLACE FUNCTION queue_reservation_notice() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        IF NEW.status = OLD.status THEN RETURN NEW; END IF;
      END IF;
      INSERT INTO trip_notifications (event_key, user_id, subject, message)
      SELECT 'reserva/' || NEW.id || '/' || NEW.status, u.id,
        'Actualización de tu reserva en Jalón USC',
        'Estado de la reserva: ' || NEW.status || '. Abre Jalón USC para consultar el viaje.'
      FROM users u WHERE u.status = 'approved' AND u.trip_email_opt_in
        AND u.email_verified_at IS NOT NULL AND
        (u.id = NEW.passenger_id OR u.id = (SELECT driver_id FROM trips WHERE id = NEW.trip_id))
      ON CONFLICT DO NOTHING;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS reservation_notification ON reservations;
    CREATE TRIGGER reservation_notification AFTER INSERT OR UPDATE OF status ON reservations
      FOR EACH ROW EXECUTE FUNCTION queue_reservation_notice();
    CREATE OR REPLACE FUNCTION queue_trip_notice() RETURNS trigger AS $$
    BEGIN
      IF NEW.status = OLD.status OR NEW.status NOT IN ('EnCurso', 'Completado') THEN RETURN NEW; END IF;
      INSERT INTO trip_notifications (event_key, user_id, subject, message)
      SELECT 'viaje/' || NEW.id || '/' || NEW.status, u.id, 'Estado de tu viaje en Jalón USC',
        'El viaje cambió a ' || NEW.status || '. Consulta los detalles en Jalón USC.'
      FROM users u WHERE u.status = 'approved' AND u.trip_email_opt_in
        AND u.email_verified_at IS NOT NULL AND (u.id = NEW.driver_id OR EXISTS (
          SELECT 1 FROM reservations r WHERE r.trip_id = NEW.id
          AND r.passenger_id = u.id AND r.status = 'Confirmada'))
      ON CONFLICT DO NOTHING;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS trip_notification ON trips;
    CREATE TRIGGER trip_notification AFTER UPDATE OF status ON trips
      FOR EACH ROW EXECUTE FUNCTION queue_trip_notice();

  `)
    return db
}
