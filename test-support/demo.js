import { seedDemo as seedApplicationDemo } from '../server/demo.js'
import { hashPassword } from '../server/auth.js'

export async function seedDemo(db, now = Date.now()) {
  const date = await seedApplicationDemo(db, now)
  await db.query(
    `INSERT INTO users (id, email, password, status, alias, mobility, email_verified_at)
     VALUES ('demo-second', 'invitado.demo@usc.edu.co', $1, 'approved', 'Pasajero de prueba', false, CURRENT_TIMESTAMP)`,
    [await hashPassword('JalonDemo-2026!')],
  )
  const { rows: [trip] } = await db.query("SELECT itinerary FROM trips WHERE id = 'demo-close'")
  const maximum = Math.floor(trip.itinerary[0].costToNextCop / 2)
  await db.query(
    `INSERT INTO reservations (id, trip_id, passenger_id, board_index, alight_index, status, maximum_cop, requested_at)
     VALUES ('demo-b-start', 'demo-close', 'demo-second', 0, 1, 'Pendiente', $1, $2)`,
    [maximum, new Date(now).toISOString()],
  )
  return date
}
