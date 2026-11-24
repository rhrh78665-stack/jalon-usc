import { requireRule } from './rules.js'

export function lateCancellation(pickup, now = Date.now()) {
  const remaining = new Date(pickup).getTime() - now
  return Number.isFinite(remaining) && remaining >= 0 && remaining < 60 * 60 * 1000
}

export function mountPenalties(app, db, approvedSession) {
  app.get('/api/penalties', async (req, res) => {
    const { id } = await approvedSession(req)
    const result = await db.transaction(async tx => {
      const { rows: [user] } = await tx.query(
        `SELECT suspended_until AS "suspendedUntil", suspended_until > clock_timestamp() AS suspended
         FROM users WHERE id = $1`, [id],
      )
      requireRule(user, 'Sesión no activa.', 401)
      const { rows } = await tx.query(
        `SELECT w.reservation_id AS "reservationId", w.reason, w.created_at AS "createdAt",
                w.created_at >= clock_timestamp() - interval '30 days' AS active, t.route
         FROM booking_warnings w JOIN reservations r ON r.id = w.reservation_id
         JOIN trips t ON t.id = r.trip_id WHERE w.passenger_id = $1
         ORDER BY w.created_at DESC, w.reservation_id LIMIT 100`, [id],
      )
      const { rows: [count] } = await tx.query(
        `SELECT count(*)::int AS count FROM booking_warnings
         WHERE passenger_id = $1 AND created_at >= clock_timestamp() - interval '30 days'`, [id],
      )
      return { ...user, suspended: Boolean(user.suspended), activeWarnings: count.count, warnings: rows }
    })
    res.json(result)
  })
}
