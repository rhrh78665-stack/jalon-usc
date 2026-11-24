import { paradas } from '../shared/paradas.js'
import { nearbyStops } from '../shared/proximidad.js'
import { requireRule } from './rules.js'

export function mountStops(app, approvedSession) {
  app.get('/api/stops/nearby', async (req, res) => {
    await approvedSession(req)
    const number = (key, min, max) => {
      const raw = req.query[key]
      const value = Number(raw)
      requireRule(typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(value) &&
        value >= min && value <= max, 'Revisa las coordenadas y el radio de búsqueda.')
      return value
    }
    const latitude = number('latitude', -90, 90)
    const longitude = number('longitude', -180, 180)
    const radius = number('radius', 0, 5000)
    res.json(nearbyStops(paradas, { latitude, longitude }, radius))
  })
}
