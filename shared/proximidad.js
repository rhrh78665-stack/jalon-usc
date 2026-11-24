const earthRadiusMeters = 6371000
const radians = degrees => degrees * Math.PI / 180

export function distanceMeters(first, second) {
  const latitude = radians(second.latitude - first.latitude)
  const longitude = radians(second.longitude - first.longitude)
  const value = Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(longitude / 2) ** 2
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(Math.min(1, Math.max(0, value))))
}

export function nearbyStops(stops, point, radius) {
  return stops.map(stop => ({ ...stop, distanceMeters: distanceMeters(point, stop) }))
    .filter(stop => stop.distanceMeters <= radius + 1e-7)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id))
}
