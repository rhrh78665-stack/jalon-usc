import { paradas, tramos } from '../shared/paradas.js'
import { localPoint } from '../shared/route-points.js'
import { requireRule } from './rules.js'

export function selectedPoints(route, points = []) {
  requireRule(Array.isArray(route) && route.length >= 2 && route.length <= 10 && new Set(route).size === route.length, 'Elige entre dos y diez paradas diferentes.')
  requireRule(Array.isArray(points) && points.length <= 10, 'Las paradas del recorrido no son válidas.')
  const custom = new Map()
  for (const point of points) {
    requireRule(point && typeof point.id === 'string' && /^point-[a-z0-9-]{1,60}$/.test(point.id) &&
      !custom.has(point.id) && route.includes(point.id) && localPoint(point) && typeof point.nombre === 'string' &&
      point.nombre.trim().length >= 3 && point.nombre.trim().length <= 80 && !/[<>\x00-\x1f]/.test(point.nombre),
      'Pon un nombre válido y marca la parada dentro del área de Cali.')
    custom.set(point.id, { id: point.id, nombre: point.nombre.trim(), latitude: point.latitude, longitude: point.longitude })
  }
  const result = route.map(id => paradas.find(point => point.id === id) || custom.get(id))
  requireRule(result.every(Boolean), 'Selecciona una parada conocida o márcala en el mapa.')
  return result
}

export function routeCatalog(points, tolls) {
  return points.slice(0, -1).map((point, i) => {
    const next = points[i + 1]
    const existing = tramos.find(s => (s.from === point.id && s.to === next.id) || (s.to === point.id && s.from === next.id))
    if (existing) return { ...existing, tollCop: tolls?.[existing.from + ':' + existing.to] ?? existing.tollCop }
    const rad = value => value * Math.PI / 180
    const a = Math.sin(rad(next.latitude-point.latitude)/2)**2 + Math.cos(rad(point.latitude))*Math.cos(rad(next.latitude))*Math.sin(rad(next.longitude-point.longitude)/2)**2
    const distanceKm = Math.max(.3, Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) * 1.3 * 10) / 10)
    return { from: point.id, to: next.id, distanceKm, tollCop: 0, active: true }
  })
}
