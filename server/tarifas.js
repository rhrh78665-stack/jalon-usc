import { defaultFare, validFare } from '../shared/fare-policy.js'
import { tramos } from '../shared/paradas.js'
import { requireRule } from './rules.js'

export async function tarifaVigente(db) {
  const { rows: [tarifa] } = await db.query(
    `SELECT version::int, fuel_price AS "fuelPriceCopPerGallon", tolls, fare
     FROM trip_tariffs ORDER BY version DESC LIMIT 1`,
  )
  return tarifa ?? null
}

export function mountTariffs(app, db, approvedSession) {
  app.get('/api/trips/tarifa', async (req, res) => {
    await approvedSession(req)
    res.json(await tarifaVigente(db))
  })

  app.post('/api/movilidad/tarifas/nueva', async (req, res) => {
    const user = await approvedSession(req)
    requireRule(user.mobility, 'Solo Movilidad puede configurar tarifas.', 403)
    requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)
    const { fuelPriceCopPerGallon, tolls, fare = defaultFare } = req.body ?? {}
    requireRule(validFare(fare), 'La tarifa mínima debe estar entre $11.000 y $25.000 por persona y los valores deben ser enteros válidos.')
    requireRule(Number.isInteger(fuelPriceCopPerGallon) && fuelPriceCopPerGallon > 0 &&
      fuelPriceCopPerGallon <= 1000000000, 'Indica un precio por galón válido.')
    requireRule(tolls && typeof tolls === 'object' && !Array.isArray(tolls) &&
      Object.keys(tolls).length === tramos.length &&
      tramos.every(({ from, to }) => Number.isInteger(tolls[from + ':' + to]) &&
        tolls[from + ':' + to] >= 0 && tolls[from + ':' + to] <= 1000000000), 'Indica un peaje válido por tramo.')
    const { rows: [tarifa] } = await db.query(
      `INSERT INTO trip_tariffs (fuel_price, tolls, configured_by, fare) VALUES ($1, $2::jsonb, $3, $4::jsonb)
       RETURNING version::int, fuel_price AS "fuelPriceCopPerGallon", tolls, fare`,
      [fuelPriceCopPerGallon, JSON.stringify(tolls), user.id, JSON.stringify(fare)],
    )
    res.status(201).json(tarifa)
  })
}
