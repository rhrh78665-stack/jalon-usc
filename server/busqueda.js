import { journeyIdentity } from './presentacion-viaje.js'
import { cotizar, diferenciaHorario, horaLocal } from './itinerarios.js'

export function tripSearch(db) {
  const cache = new Map()
  const ready = db.listen('jalon_trip_search', () => cache.clear())

  async function load({ origin, destination, date, target }) {
    return db.transaction(async tx => {
      const { rows: trips } = await tx.query(
        `SELECT t.id, t.driver_id AS "driverId", t.depart_at AS "departAt", t.capacity, t.route, t.status, t.itinerary,
           v.id AS "vehicleId", v.brand, v.model, v.color, v.plate, v.photo_data IS NOT NULL AS "hasPhoto",
           v.photo_reference AS "photoReference", u.alias AS "driverName"
         FROM trips t JOIN users u ON u.id = t.driver_id JOIN vehicles v ON v.id = t.vehicle_id WHERE t.status IN ('Programado', 'Lleno') AND depart_at > clock_timestamp()
         AND jsonb_array_length(itinerary) >= 2 AND route @> $1::jsonb`,
        [JSON.stringify([origin, destination])],
      )
      const { rows: bookings } = await tx.query(
        `SELECT r.trip_id, r.board_index, r.alight_index, r.status FROM reservations r
         JOIN trips t ON t.id = r.trip_id WHERE r.status = 'Confirmada'
         AND t.status IN ('Programado', 'Lleno') AND t.depart_at > clock_timestamp()
         AND t.route @> $1::jsonb`, [JSON.stringify([origin, destination])],
      )
      const grouped = new Map()
      for (const booking of bookings) {
        const group = grouped.get(booking.trip_id) ?? []
        group.push(booking)
        grouped.set(booking.trip_id, group)
      }
      const matches = []
      for (const trip of trips) {
        if (trip.route.indexOf(destination) <= trip.route.indexOf(origin)) continue
        const quote = cotizar(trip, grouped.get(trip.id) ?? [], origin, destination)
        if (quote.availableSeats < 1 || (!target && horaLocal(quote.boardAt).slice(0, 10) !== date)) continue
        const difference = diferenciaHorario(trip, quote, target)
        if (difference !== null) matches.push({ trip, quote, difference })
      }
      const sorted = matches.sort((a, b) => a.difference - b.difference ||
        new Date(a.trip.departAt) - new Date(b.trip.departAt) || a.trip.id.localeCompare(b.trip.id))
      return { sorted, drivers: new Set(sorted.map(item => item.trip.driverId)), pages: new Map(), expiresAt: Math.min(Date.now() + 60000, ...sorted.map(item => Date.parse(item.trip.departAt))) }
    })
  }

  return async function search({ userId, page, pageSize, ...query }) {
    await ready
    const key = JSON.stringify(query)
    let entry = cache.get(key)
    if (!entry || (entry.value && Date.now() >= entry.value.expiresAt)) {
      if (cache.size >= 128) cache.delete(cache.keys().next().value)
      entry = { promise: load(query) }
      entry.promise.then(value => { entry.value = value }, () => {})
      cache.set(key, entry)
    }
    let loaded
    try { loaded = await entry.promise }
    catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error }
    const excluded = loaded.drivers.has(userId) ? userId : ''
    const pageKey = JSON.stringify([excluded, page, pageSize])
    if (!loaded.pages.has(pageKey)) {
      const matches = excluded ? loaded.sorted.filter(item => item.trip.driverId !== excluded) : loaded.sorted
      const result = {
        page, pageSize, total: matches.length,
        items: matches.slice((page - 1) * pageSize, page * pageSize).map(({ trip, quote }) => ({
          id: trip.id, departAt: trip.departAt, route: trip.route, itinerary: trip.itinerary, status: trip.status, ...quote, ...journeyIdentity(trip),
        })),
      }
      if (loaded.pages.size >= 128) loaded.pages.delete(loaded.pages.keys().next().value)
      loaded.pages.set(pageKey, result)
    }
    return loaded.pages.get(pageKey)
  }
}
