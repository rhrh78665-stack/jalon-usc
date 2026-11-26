import { accountRole } from './roles.js'
import { requireRule } from './rules.js'
import { journeyIdentity } from './presentacion-viaje.js'

export function mountHistory(app, db, approvedSession) {
  app.get('/api/journeys/history', async (req, res) => {
    const user = await approvedSession(req)
    const role = accountRole(user)
    const page = Number(req.query.page ?? 1), pageSize = 12
    const status = req.query.status ?? ''
    requireRule(Number.isSafeInteger(page) && page >= 1 && page <= 1000000, 'La página no es válida.')
    requireRule(['', 'Completado', 'Cancelado'].includes(status), 'El estado no es válido.')
    if (user.mobility) return res.json({page,pageSize,total:0,items:[]})
    const result = await db.transaction(async tx => {
      const joins = `FROM trips t JOIN users u ON u.id=t.driver_id JOIN vehicles v ON v.id=t.vehicle_id
        LEFT JOIN reservations r ON r.trip_id=t.id AND r.passenger_id=$1 AND $3='pasajero'`
      const where = `WHERE (($3='conductor' AND t.driver_id=$1) OR ($3='pasajero' AND r.id IS NOT NULL))
          AND (t.status IN ('Completado','Cancelado') OR t.depart_at<clock_timestamp()
               OR r.status IN ('Cancelada','Rechazada','Vencida'))
          AND ($2='' OR ($2='Completado' AND t.status='Completado')
            OR ($2='Cancelado' AND (t.status='Cancelado' OR r.status='Cancelada')))`
      const { rows: [count] } = await tx.query(`SELECT count(*)::int AS total ${joins} ${where}`, [user.id, status, role])
      const { rows } = await tx.query(`SELECT t.id, r.id AS "reservationId", t.depart_at AS "departAt", t.route, t.itinerary,
          t.status, t.cancel_reason AS "cancelReason", t.driver_id = $1 AS "asDriver",
          r.status AS "reservationStatus", r.board_index, r.alight_index,
          CASE WHEN t.driver_id = $1 THEN (t.liquidation->>'totalCop')::int
               ELSE (t.liquidation->'aportes'->>r.id)::int END AS "settledCop",
          r.maximum_cop AS "maximumCop", u.alias AS "driverName", v.id AS "vehicleId",
          v.brand, v.model, v.color, v.plate, v.photo_data IS NOT NULL AS "hasPhoto",
          v.photo_reference AS "photoReference"
        ${joins} ${where}
        ORDER BY t.depart_at DESC, t.id DESC, r.requested_at DESC, r.id DESC LIMIT $4 OFFSET $5`, [user.id, status, role, pageSize, (page-1)*pageSize])
      return { page, pageSize, total: count.total, items: rows.map(row => ({
        id: row.id, entryId: row.asDriver ? 'driver/' + row.id : 'reservation/' + row.reservationId, departAt: row.departAt, itinerary: row.itinerary, status: row.status,
        reservationStatus: row.reservationStatus, asDriver: row.asDriver, cancelReason: row.cancelReason,
        origin: row.route[row.asDriver ? 0 : row.board_index], destination: row.route[row.asDriver ? row.route.length-1 : row.alight_index],
        settledCop: row.settledCop, maximumCop: row.maximumCop, ...journeyIdentity(row),
      })) }
    })
    res.json(result)
  })
}
