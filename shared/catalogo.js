// The passenger catalogue is built only from offers already published by drivers.
export function groupPublishedRoutes(offers) {
  const groups = new Map()
  for (const offer of offers) {
    const key = offer.route.join('|')
    if (!groups.has(key)) groups.set(key, { key, route: offer.route, itinerary: offer.itinerary, offers: [] })
    groups.get(key).offers.push(offer)
  }
  return [...groups.values()].map(group => ({
    ...group,
    availableSeats: group.offers.reduce((total, offer) => total + offer.availableSeats, 0),
    minimumCop: Math.min(...group.offers.map(offer => offer.maximumCop)),
  }))
}

export function publishedStopList(offers) {
  const points = new Map()
  for (const offer of offers) for (const stop of offer.itinerary) {
    const key = stop.stopId
    if (!points.has(key)) points.set(key, { ...stop, offers: new Set() })
    points.get(key).offers.add(offer.id)
  }
  return [...points.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))
}
