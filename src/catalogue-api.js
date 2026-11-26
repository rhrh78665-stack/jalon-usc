import { api } from './Itinerario.jsx'

export async function loadPublishedOffers(date, signal) {
  const first = await api('/api/journeys/available?' + new URLSearchParams({ date, pageSize:'100', page:'1', sort:'departure' }), { signal })
  const offers = new Map(first.items.map(offer => [offer.id, offer]))
  for (let page = 2; page <= Math.ceil(first.total / first.pageSize); page++) {
    const next = await api('/api/journeys/available?' + new URLSearchParams({ date, pageSize:'100', page:String(page), sort:'departure' }), { signal })
    for (const offer of next.items) offers.set(offer.id, offer)
  }
  return { ...first, items:[...offers.values()] }
}
