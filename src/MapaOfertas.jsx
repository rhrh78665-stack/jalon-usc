import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { itineraryPoints, pointName } from '../shared/route-points.js'

export default function MapaOfertas({ trips, onSelect }) {
  const host = useRef(null), callback = useRef(onSelect)
  const [failed, setFailed] = useState(false)
  callback.current = onSelect
  useEffect(() => {
    const map = L.map(host.current, { scrollWheelZoom: false }).setView([3.405, -76.542], 12)
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { minZoom: 10, maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map)
    let errors = 0; tiles.on('tileerror', () => { if (++errors >= 3) setFailed(true) })
    const points = [], groups = new Map()
    for (const trip of trips) {
      const point = itineraryPoints(trip).find(p => p.id === trip.origin)
      if (!point) continue
      const key = point.latitude.toFixed(5) + ',' + point.longitude.toFixed(5)
      if (!groups.has(key)) groups.set(key, { point, trips: [] })
      groups.get(key).trips.push(trip)
    }
    for (const { point, trips: offers } of groups.values()) {
      points.push([point.latitude, point.longitude])
      const content = document.createElement('div'); content.className = 'offer-map-popup'
      const heading = document.createElement('strong'); heading.textContent = point.nombre + ' · ' + offers.length + (offers.length === 1 ? ' oferta' : ' ofertas'); content.append(heading)
      for (const trip of offers) {
        const row = document.createElement('div'); row.className = 'offer-map-popup-row'
        const name = document.createElement('b'); name.textContent = trip.driver.name
        const route = document.createElement('p'); route.textContent = pointName(trip,trip.origin) + ' → ' + pointName(trip,trip.destination)
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Ver recorrido'; button.addEventListener('click', () => callback.current(trip))
        row.append(name,route,button); content.append(row)
      }
      const icon = L.divIcon({ className: 'offer-group-icon', html: '<span class="offer-group-pin' + ((point.id === 'usc' || point.id === 'point-city-usc') ? ' campus-pin' : '') + '">' + offers.length + '</span>', iconSize: [36,36], iconAnchor: [18,18] })
      const marker = L.marker([point.latitude,point.longitude], { icon, title: point.nombre + ': ' + offers.length + ' ofertas', alt: point.nombre }).addTo(map)
      marker.bindPopup(content, { maxHeight: 300 }); marker.bindTooltip(point.nombre, { direction: 'top' })
    }
    if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [40,40], maxZoom: 13 })
    const observer = new ResizeObserver(() => map.invalidateSize()); observer.observe(host.current)
    return () => { observer.disconnect(); map.remove() }
  }, [trips])
  return <div className="offer-overview-map"><header><span className="card-eyebrow">Rutas publicadas en Cali</span><h3>Cada punto tiene un recorrido.</h3><p>Abre un punto para consultar las ofertas y sus paradas.</p></header><div ref={host} className="offer-overview-canvas" role="region" aria-label="Mapa de puntos de salida de las ofertas" />{failed && <p className="geo-warning" role="status">Algunas calles no cargaron. Las ofertas siguen disponibles en las tarjetas.</p>}<footer><span><i /> Salida en Cali</span><span><i /> Salida del campus</span></footer></div>
}
