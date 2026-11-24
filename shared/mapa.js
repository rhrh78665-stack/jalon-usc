import { paradas } from './paradas.js'

export function mapPoints(ids) {
  const selected = ids.map(id => paradas.find(stop => stop.id === id))
  if (selected.length < 2 || selected.some(stop => !stop)) return []
  const west = Math.min(...selected.map(stop => stop.longitude))
  const east = Math.max(...selected.map(stop => stop.longitude))
  const south = Math.min(...selected.map(stop => stop.latitude))
  const north = Math.max(...selected.map(stop => stop.latitude))
  return selected.map(stop => ({
    ...stop,
    x: 80 + (stop.longitude - west) / Math.max(east - west, 0.01) * 480,
    y: 220 - (stop.latitude - south) / Math.max(north - south, 0.01) * 160,
  }))
}
