import { selectedPoints } from './puntos-recorrido.js'
import { paradas } from '../shared/paradas.js'
import { requireRule, RuleError } from './rules.js'

export function routeStops(value) {
  requireRule(typeof value === 'string' && value.length <= 160, 'Selecciona las paradas del recorrido.')
  const ids = value.split(',')
  requireRule(ids.length >= 2 && ids.length <= paradas.length && new Set(ids).size === ids.length,
    'Selecciona al menos dos paradas distintas.')
  const stops = ids.map(id => paradas.find(stop => stop.id === id))
  requireRule(stops.every(Boolean), 'Una parada no pertenece al catálogo.')
  return stops
}

export function roadRoute(data, stops) {
  const route = data?.routes?.[0]
  requireRule(data?.code === 'Ok' && route?.geometry?.type === 'LineString' &&
    Array.isArray(route.geometry.coordinates) && route.geometry.coordinates.length >= 2 &&
    route.geometry.coordinates.length <= 50000 &&
    Number.isFinite(route.distance) && route.distance > 0 &&
    Number.isFinite(route.duration) && route.duration > 0 &&
    Array.isArray(route.legs) && route.legs.length === stops.length - 1,
  'No se pudo obtener una ruta vial para estas paradas.', 502)
  requireRule(route.geometry.coordinates.every(point => Array.isArray(point) && point.length === 2 &&
    point.every(Number.isFinite) && point[0] >= -77 && point[0] <= -76 && point[1] >= 3 && point[1] <= 4),
  'La ruta recibida está fuera de la zona del catálogo.', 502)
  requireRule(route.legs.every(leg => Number.isFinite(leg.distance) && leg.distance >= 0 &&
    Number.isFinite(leg.duration) && leg.duration >= 0), 'La ruta recibida está incompleta.', 502)
  return {
    stops: stops.map(({ id, nombre, latitude, longitude }) => ({ id, nombre, latitude, longitude })),
    geometry: route.geometry,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    legs: route.legs.map(leg => ({ distanceMeters: leg.distance, durationSeconds: leg.duration })),
    calculatedAt: new Date().toISOString(),
    trafficIncluded: false,
  }
}

export function createRoadService({ fetcher = fetch, base = process.env.JALON_ROUTING_URL || 'https://router.project-osrm.org' } = {}) {
  const provider = new URL(base)
  requireRule(provider.protocol === 'https:' || (provider.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(provider.hostname)),
    'El proveedor de rutas debe utilizar HTTPS.')
  const cache = new Map()
  const pending = new Map()
  let queue = Promise.resolve()
  let lastRequest = 0
  return async stops => {
    const key = JSON.stringify(stops.map(stop => [stop.id, stop.nombre, stop.latitude, stop.longitude]))
    const saved = cache.get(key)
    if (saved && Date.now() - saved.at < 86400000) return saved.value
    if (pending.has(key)) return pending.get(key)
    requireRule(pending.size < 12, 'El mapa está ocupado. Intenta de nuevo en unos segundos.', 503)
    const task = queue.catch(() => {}).then(async () => {
      const pause = Math.max(0, 1100 - (Date.now() - lastRequest))
      if (pause) await new Promise(resolve => setTimeout(resolve, pause))
      lastRequest = Date.now()
      const coordinates = stops.map(stop => stop.longitude + ',' + stop.latitude).join(';')
      const url = new URL('/route/v1/driving/' + coordinates, provider)
      url.search = new URLSearchParams({ overview: 'full', geometries: 'geojson', steps: 'false', alternatives: 'false' })
      try {
        const response = await fetcher(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json', 'User-Agent': 'JalonUSC-AcademicMap/1.0' } })
        requireRule(response.ok, 'El servicio de rutas no está disponible.', 503)
        const value = roadRoute(await response.json(), stops)
        if (cache.size >= 128) cache.delete(cache.keys().next().value)
        cache.set(key, { at: Date.now(), value })
        return value
      } catch {
        throw new RuleError('No pudimos cargar la ruta vial. Puedes continuar con el itinerario y reintentar el mapa.', 503)
      }
    })
    pending.set(key, task)
    queue = task
    try { return await task } finally { pending.delete(key) }
  }
}

export function mountRoadMap(app, approvedSession, options) {
  const route = options?.route ?? createRoadService(options)
  app.post('/api/map/route', async (req, res) => {
    await approvedSession(req)
    requireRule(req.is('application/json'), 'Envía las paradas como JSON.', 415)
    const stops = selectedPoints(req.body?.stops, req.body?.points)
    res.json(await route(stops))
  })
  app.get('/api/map/route', async (req, res) => {
    await approvedSession(req)
    const stops = routeStops(req.query.stops)
    res.json(await route(stops))
  })
}
