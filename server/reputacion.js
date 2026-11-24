import { requireRule } from './rules.js'

export function mountReputation(app, db, approvedSession) {

  app.get('/api/trips/:id/reputation', async (req, res) => {
    const user = await approvedSession(req)
    const { rows: [trip] } = await db.query(
      `SELECT driver_id FROM trips t WHERE t.id = $1 AND (
        (t.status IN ('Programado', 'Lleno') AND t.depart_at > clock_timestamp())
        OR t.driver_id = $2 OR EXISTS (
          SELECT 1 FROM reservations r WHERE r.trip_id = t.id AND r.passenger_id = $2))`,
      [req.params.id, user.id],
    )
    requireRule(trip, 'No se encontró un viaje visible.', 404)
    const { rows: [summary] } = await db.query(
      'SELECT count(*)::int AS count, round(avg(stars), 1)::text AS average FROM ratings WHERE target_id = $1',
      [trip.driver_id],
    )
    res.json({ count: summary.count, average: summary.average === null ? null : Number(summary.average) })
  })

  app.get('/api/reputation/:userId', async (req, res) => {
    const user = await approvedSession(req)
    const target = req.params.userId === 'mine' ? user.id : req.params.userId
    const { rows: [profile] } = await db.query(
      `SELECT u.id, COALESCE(NULLIF(u.alias, ''), 'Miembro USC') AS alias,
         count(r.stars)::int AS count, round(avg(r.stars), 1)::text AS average
       FROM users u LEFT JOIN ratings r ON r.target_id = u.id
       WHERE u.id = $1 AND u.status = 'approved' GROUP BY u.id`, [target],
    )
    requireRule(profile, 'No se encontró un perfil visible.', 404)
    res.json({ ...profile, average: profile.average === null ? null : Number(profile.average) })
  })
}
