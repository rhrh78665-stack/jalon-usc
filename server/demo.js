import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashPassword } from './auth.js'
import { openDatabase } from './db.js'
import { startServer } from './index.js'
import { crearItinerario, fijarCostos, horaBogota, horaLocal } from './itinerarios.js'

const accounts = [
  ['demo-driver', 'conductor.demo@usc.edu.co', 'Camilo Demo', false],
  ['demo-passenger', 'pasajero.demo@usc.edu.co', 'Valentina Demo', false],
  ['demo-second', 'invitado.demo@usc.edu.co', 'Daniel Demo', false],
  ['demo-mobility', 'movilidad.demo@usc.edu.co', 'Movilidad Demo', true],
]
const password = 'JalonDemo-2026!'
const port = Number(process.env.PORT ?? 3001)
const minute = 60000

export async function seedDemo(db, now = Date.now()) {
  const hash = await hashPassword(password)
  const tomorrow = horaLocal(new Date(now + 24 * 60 * minute)).slice(0, 10)

  await db.transaction(async tx => {
    for (const [id, email, alias, mobility] of accounts) {
      await tx.query(
        `INSERT INTO users (id, email, password, status, alias, mobility, email_verified_at)
         VALUES ($1, $2, $3, 'approved', $4, $5, CURRENT_TIMESTAMP)`, [id, email, hash, alias, mobility],
      )
    }
    await tx.exec(`
      INSERT INTO driver_permissions (user_id, reviewer_id, license_expires_on)
      VALUES ('demo-driver', 'demo-mobility', CURRENT_DATE + 365);
      INSERT INTO vehicles (id, user_id, plate, seats, efficiency)
      VALUES ('demo-car', 'demo-driver', 'DEM001', 4, 30);
    `)

    async function trip(id, dateTime, route, capacity, status = 'Programado') {
      const departAt = horaBogota(dateTime)
      const stops = route.map((_, position) =>
        horaLocal(new Date(Date.parse(departAt) + position * 20 * minute)))
      const { itinerary, pricing } = fijarCostos(crearItinerario(route, stops, departAt), 30, 15000)
      await tx.query(
        `INSERT INTO trips (id, driver_id, vehicle_id, depart_at, capacity, route, status, itinerary, pricing)
         VALUES ($1, 'demo-driver', 'demo-car', $2, $3, $4::jsonb, $5, $6::jsonb, $7::jsonb)`,
        [id, departAt, capacity, JSON.stringify(route), status, JSON.stringify(itinerary), JSON.stringify(pricing)],
      )
      return itinerary
    }

    const filled = await trip('demo-cancel', tomorrow + 'T07:00', ['melendez', 'lido', 'usc'], 1, 'Lleno')
    const ready = await trip('demo-close', horaLocal(new Date(now - 2 * minute)), ['unicentro', 'usc'], 2)
    const delayed = await trip('demo-expire', tomorrow + 'T09:00', ['melendez', 'usc'], 2)
    await trip('demo-search', tomorrow + 'T11:00', ['usc', 'lido'], 2)

    for (const [id, tripId, passenger, itinerary, destination, status, age] of [
      ['demo-b-cancel', 'demo-cancel', 'demo-passenger', filled, 2, 'Confirmada', 0],
      ['demo-b-close', 'demo-close', 'demo-passenger', ready, 1, 'Confirmada', 0],
      ['demo-b-start', 'demo-close', 'demo-second', ready, 1, 'Pendiente', 0],
      ['demo-b-expire', 'demo-expire', 'demo-passenger', delayed, 1, 'Pendiente', 45],
    ]) {
      const maximum = itinerary.slice(0, destination).reduce((sum, stop) => sum + Math.floor(stop.costToNextCop / 2), 0)
      await tx.query(
        `INSERT INTO reservations (id, trip_id, passenger_id, board_index, alight_index, status, maximum_cop, requested_at)
         VALUES ($1, $2, $3, 0, $4, $5, $6, $7)`,
        [id, tripId, passenger, destination, status, maximum, new Date(now - age * minute).toISOString()],
      )
    }
  })

  return tomorrow
}

if (import.meta.main) {
  const folder = await mkdtemp(join(tmpdir(), 'jalon-demo-'))
  const cleanup = () => rm(folder, { recursive: true, force: true })
  const db = await openDatabase(join(folder, 'pg'))
  try {
    process.env.NODE_ENV = 'development'
    process.env.JALON_RESPONSE_MINUTES = '30'
    process.env.PORT = String(port)
    const date = await seedDemo(db)
    const url = await startServer(db, port, { cleanup, mail: null })
    console.log('Jalón USC · demostración local: ' + url)
    console.log('Fecha de los viajes futuros (Cali): ' + date)
    console.log('Cuentas: ' + accounts.map(([, email]) => email).join(', '))
    console.log('Contraseña de demostración: ' + password)
  } catch (error) {
    await db.close()
    await cleanup()
    throw error
  }
}
