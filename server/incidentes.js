import { randomUUID } from 'node:crypto'
import { requireRule } from './rules.js'

const fields = `i.id, i.trip_id AS "tripId", i.category, i.description, i.status,
  i.created_at AS "createdAt", t.route`

export function mountIncidents(app, db, approvedSession) {
  app.get('/api/incidents/trips', async (req, res) => {
    const user = await approvedSession(req)
    const { rows } = await db.query(
      `SELECT t.id, t.route, t.depart_at AS "departAt" FROM trips t
       WHERE t.driver_id = $1 OR EXISTS (
         SELECT 1 FROM reservations r WHERE r.trip_id = t.id
         AND r.passenger_id = $1 AND r.status = 'Confirmada')
       ORDER BY t.depart_at DESC, t.id`, [user.id],
    )
    res.json(rows)
  })

  app.get('/api/incidents', async (req, res) => {
    const user = await approvedSession(req)
    const { rows } = await db.query(
      `SELECT ${fields} FROM incidents i JOIN trips t ON t.id = i.trip_id
       WHERE i.reporter_id = $1 OR $2::boolean ORDER BY i.created_at DESC, i.id`,
      [user.id, user.mobility],
    )
    res.json(rows)
  })

  app.post('/api/incidents', async (req, res) => {
    const user = await approvedSession(req)
    requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)
    const { tripId, category, description } = req.body ?? {}
    const text = typeof description === 'string' ? description.trim() : ''
    requireRule(typeof tripId === 'string' && tripId.length <= 100, 'Selecciona un viaje.')
    requireRule(['seguridad', 'conducta', 'vehiculo', 'otro'].includes(category), 'Selecciona una categoría.')
    requireRule(text.length >= 10 && text.length <= 2000, 'Describe el incidente entre 10 y 2000 caracteres.')
    const incident = await db.transaction(async tx => {
      const { rows: [trip] } = await tx.query(
        `SELECT id FROM trips WHERE id = $1 AND (driver_id = $2 OR EXISTS (
           SELECT 1 FROM reservations r WHERE r.trip_id = trips.id
           AND r.passenger_id = $2 AND r.status = 'Confirmada')) FOR SHARE`,
        [tripId, user.id],
      )
      requireRule(trip, 'Solo los participantes autorizados pueden reportar este viaje.', 403)
      const { rows: [saved] } = await tx.query(
        `INSERT INTO incidents (id, trip_id, reporter_id, category, description)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, status`,
        [randomUUID(), trip.id, user.id, category, text],
      )
      return saved
    })
    res.status(201).json(incident)
  })
}
