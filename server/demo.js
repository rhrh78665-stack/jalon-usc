import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashPassword } from './auth.js'
import { openDatabase } from './db.js'
import { startServer } from './index.js'
import { defaultFare } from '../shared/fare-policy.js'
import { distanceFare } from './precio-recorrido.js'
import { demoCorridors } from '../shared/demo-corridors.js'
import { demoFleet } from '../shared/demo-fleet.js'
import { selectedPoints, routeCatalog } from './puntos-recorrido.js'
import { calcularLiquidacion } from './liquidacion.js'
import { precioGalonDemo } from '../shared/paradas.js'
import { configurarCorreo } from './correo.js'
import { crearItinerario, fijarCostos, horaBogota, horaLocal } from './itinerarios.js'

const accounts = [
  ['demo-driver', 'conductor.demo@usc.edu.co', 'Carlos Rivas', false],
  ['demo-passenger', 'pasajero.demo@usc.edu.co', 'Valentina Torres', false],
  ['demo-mobility', 'movilidad.demo@usc.edu.co', 'Coordinación de Movilidad', true],
]
const fleet = demoFleet
const members = fleet.slice(1).map(car => [car.user, car.email, car.name, false])
const password = 'JalonDemo-2026!'
const port = Number(process.env.PORT ?? 3001)
const minute = 60000
const demoRoadMaps = JSON.parse(await readFile(new URL('./fixtures/demo-road-maps.json', import.meta.url), 'utf8'))

export async function seedDemo(db, now = Date.now()) {
  const tomorrow = horaLocal(new Date(now + 24 * 60 * minute)).slice(0, 10)

  await db.transaction(async tx => {
    for (const [id, email, alias, mobility] of [...accounts, ...members]) {
      const hash = await hashPassword(password)
      await tx.query(
        `INSERT INTO users (id, email, password, status, alias, mobility, email_verified_at)
         VALUES ($1, $2, $3, 'approved', $4, $5, CURRENT_TIMESTAMP)`, [id, email, hash, alias, mobility],
      )
    }
    for (const car of fleet) {
      const photo = await readFile(new URL('../public/vehiculos/' + car.photoAsset, import.meta.url))
      await tx.query(`INSERT INTO driver_permissions (user_id, reviewer_id, license_expires_on)
        VALUES ($1, 'demo-mobility', CURRENT_DATE + 365)`, [car.user])
      await tx.query(`INSERT INTO vehicles (id, user_id, plate, seats, efficiency, brand, model, color, photo_data, photo_reference)
        VALUES ($1, $2, $3, 4, 30, $4, $5, $6, $7, true)`,
        [car.vehicle, car.user, car.plate, car.brand, car.model, car.color, 'data:image/webp;base64,' + photo.toString('base64')])
    }

    async function trip(id, dateTime, route, capacity, status = 'Programado', fleetIndex = 0, routePoints = [], roadMap = null) {
      const car = fleet[fleetIndex]
      const departAt = horaBogota(dateTime)
      let elapsed = 0
      const stops = route.map((_, position) => {
        if (position) elapsed += roadMap ? Math.max(2, Math.ceil(roadMap.legs[position-1].durationSeconds/60)) + 2 : 20
        return horaLocal(new Date(Date.parse(departAt) + elapsed * minute))
      })
      const points = selectedPoints(route, routePoints)
      const catalog = routeCatalog(points).map((leg, index) => roadMap ? { ...leg, distanceKm: Math.max(.01, roadMap.legs[index].distanceMeters/1000) } : leg)
      const { itinerary, pricing } = fijarCostos(crearItinerario(route, stops, departAt, catalog, points), 30, precioGalonDemo, defaultFare, 'distance-v2')
      if (roadMap) { pricing.roadMap = roadMap; pricing.distanceSource = 'road' }
      await tx.query(
        `INSERT INTO trips (id, driver_id, vehicle_id, depart_at, capacity, route, status, itinerary, pricing)
         VALUES ($1, $8, $9, $2, $3, $4::jsonb, $5, $6::jsonb, $7::jsonb)`,
        [id, departAt, capacity, JSON.stringify(route), status, JSON.stringify(itinerary), JSON.stringify(pricing), car.user, car.vehicle],
      )
      return itinerary
    }

    const filled = await trip('demo-cancel', tomorrow + 'T07:00', ['melendez', 'lido', 'usc'], 1, 'Lleno')
    const ready = await trip('demo-close', horaLocal(new Date(now - 2 * minute)), ['unicentro', 'usc'], 2)
    const delayed = await trip('demo-expire', tomorrow + 'T09:00', ['melendez', 'usc'], 2)
    const today = horaLocal(new Date(now)).slice(0, 10)
    const zones = ['melendez','lido','unicentro','ciudad-jardin','caney','bochalema','san-fernando','tequendama','san-antonio','ingenio']
    const opening = Date.parse(horaBogota(today + 'T06:30'))
    const start = Math.max(now + 15 * minute, opening)
    const end = Date.parse(horaBogota(today + 'T23:50'))
    const spacing = Math.max(minute, Math.min(18 * minute, (end-start)/20))
    for (let index = 0; index < 20; index++) {
      const zone = zones[Math.floor(index/2)]
      const route = index % 2 ? ['usc',zone] : [zone,'usc']
      const departure = horaLocal(new Date(start + index * spacing))
      if (departure.slice(0,10) === today) await trip('demo-today-' + index, departure, route, 1 + index % 4, 'Programado', index)
    }
    for (const day of [1, 2]) {
      const date = horaLocal(new Date(now + day * 86400000)).slice(0,10)
      for (let index = 0; index < fleet.length; index++) {
        const corridor = demoCorridors[(index + (day-1)*3) % demoCorridors.length]
        const time = String(6 + Math.floor(index/4)).padStart(2,'0') + ':' + String((index%4)*15).padStart(2,'0')
        await trip((day===1 ? 'demo-tomorrow-' : 'demo-day-after-') + index, date+'T'+time,
          corridor.stops.map(s=>s.id), 1+index%4, 'Programado', index, corridor.stops, demoRoadMaps[corridor.id])
      }
    }
    await trip('demo-search', tomorrow + 'T11:00', ['melendez', 'usc'], 3)
    await trip('demo-return', tomorrow + 'T17:00', ['usc', 'lido'], 3, 'Programado', 1)
    await trip('demo-next-unicentro', tomorrow + 'T13:30', ['unicentro', 'usc'], 3, 'Programado', 2)

    for (const [id, tripId, passenger, itinerary, destination, status, age] of [
      ['demo-b-cancel', 'demo-cancel', 'demo-passenger', filled, 2, 'Confirmada', 0],
      ['demo-b-close', 'demo-close', 'demo-passenger', ready, 1, 'Confirmada', 0],
      ['demo-b-expire', 'demo-expire', 'demo-passenger', delayed, 1, 'Pendiente', 45],
    ]) {
      const maximum = distanceFare(itinerary, 0, destination)
      await tx.query(
        `INSERT INTO reservations (id, trip_id, passenger_id, board_index, alight_index, status, maximum_cop, requested_at)
         VALUES ($1, $2, $3, 0, $4, $5, $6, $7)`,
        [id, tripId, passenger, destination, status, maximum, new Date(now - age * minute).toISOString()],
      )
    }
    for (const [index, car] of fleet.slice(0,3).entries()) {
      const tripId = 'demo-history-' + index, bookingId = 'demo-b-history-' + index
      const departure = horaLocal(new Date(now - (24 + index * 24) * 60 * minute))
      const itinerary = await trip(tripId, departure, index % 2 ? ['usc', 'lido'] : ['melendez', 'usc'], 3, 'Completado', index)
      const reservation = { id: bookingId, board_index: 0, alight_index: 1,
        attendance: 'Abordo', maximum_cop: distanceFare(itinerary, 0, 1) }
      const liquidation = calcularLiquidacion({ itinerary }, [reservation])
      await tx.query(`INSERT INTO reservations (id, trip_id, passenger_id, board_index, alight_index, status, maximum_cop, attendance)
        VALUES ($1, $2, 'demo-passenger', 0, 1, 'Confirmada', $3, 'Abordo')`, [bookingId, tripId, reservation.maximum_cop])
      await tx.query(`UPDATE trips SET started_at=depart_at, completed_at=depart_at+interval '20 minutes', liquidation=$2::jsonb WHERE id=$1`, [tripId, JSON.stringify(liquidation)])
    }
    await trip('demo-history-cancelled', horaLocal(new Date(now - 2 * 60 * minute)), ['usc', 'unicentro'], 3, 'Cancelado')
    await tx.query("UPDATE trips SET cancel_reason='Cambio de horario académico' WHERE id='demo-history-cancelled'")
  })

  return tomorrow
}

if (import.meta.main) {
  const folder = await mkdtemp(join(tmpdir(), 'jalon-demo-'))
  const cleanup = () => rm(folder, { recursive: true, force: true })
  const db = await openDatabase(join(folder, 'pg'))
  try {
    process.env.NODE_ENV ??= 'development'
    process.env.JALON_RESPONSE_MINUTES = '30'
    process.env.PORT = String(port)
    const date = await seedDemo(db)
    const mail = process.env.JALON_MAIL_MODE === 'local' ? configurarCorreo(process.env, port) : null
    const url = await startServer(db, port, { cleanup, mail })
    console.log('Jalón USC · demostración local: ' + url)
    console.log('Fecha de los viajes futuros (Cali): ' + date)
    console.log('Cuentas: ' + accounts.map(([, email]) => email).join(', '))
  } catch (error) {
    await db.close()
    await cleanup()
    throw error
  }
}
