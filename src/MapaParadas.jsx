import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import React, { useEffect, useId, useRef, useState } from 'react'
import { paradas } from '../shared/paradas.js'

const number = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 })

export default function MapaParadas({ stops, points = [], title: mapTitle = 'Paradas del recorrido', snapshot = null, selectedOrigin, selectedDestination }) {
  const title = useId()
  const host = useRef(null)
  const instance = useRef(null)
  const [visible, setVisible] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [route, setRoute] = useState(null)
  const [error, setError] = useState('')
  const [tilesFailed, setTilesFailed] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locationMessage, setLocationMessage] = useState('')
  const selected = stops.map(id => points.find(stop => stop.id === id) || paradas.find(stop => stop.id === id)).filter(Boolean)
  const key = JSON.stringify(selected.map(point => [point.id, point.nombre, point.latitude, point.longitude]))
  const valid = selected.length >= 2 && selected.length === stops.length && new Set(stops).size === stops.length

  useEffect(() => {
    if (!host.current || !valid) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '100px' })
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [valid])

  useEffect(() => {
    if (!visible || !valid) return
    const controller = new AbortController()
    let disposed = false
    let map
    let observer
    setRoute(null)
    setError('')
    setTilesFailed(false)
    setLocationMessage('')
    setLocating(false)
    async function load() {
      try {
        if (disposed) return
        map = L.map(host.current, { scrollWheelZoom: false, zoomControl: true, attributionControl: true })
        instance.current = { map, L }
        const layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          minZoom: 10, maxZoom: 19, updateWhenIdle: true, keepBuffer: 1,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
        }).addTo(map)
        let failed = 0
        layer.on('tileerror', () => { if (!disposed && ++failed >= 3) setTilesFailed(true) })
        selected.forEach((stop, index) => {
          const destination = index === selected.length - 1
          const icon = L.divIcon({ className: 'geo-pin-wrap', html: `<span class="geo-pin${destination ? ' geo-pin-destination' : ''}">${index + 1}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] })
          const content = document.createElement('span')
          content.textContent = (index + 1) + '. ' + stop.nombre
          L.marker([stop.latitude, stop.longitude], { icon, title: stop.nombre, alt: stop.nombre }).addTo(map).bindPopup(content)
        })
        const bounds = L.latLngBounds(selected.map(stop => [stop.latitude, stop.longitude]))
        map.fitBounds(bounds, { padding: [45, 45], maxZoom: 15 })
        instance.current.bounds = bounds
        L.polyline(selected.map(point => [point.latitude, point.longitude]), { color: '#91b77b', weight: 2, dashArray: '5 7', opacity: .6, interactive: false }).addTo(map)
        observer = new ResizeObserver(() => map.invalidateSize())
        observer.observe(host.current)
        const custom = selected.filter(point => !paradas.some(known => known.id === point.id))
        const response = snapshot ? null : custom.length ? await fetch('/api/map/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stops, points: custom }), signal: controller.signal })
          : await fetch('/api/map/route?' + new URLSearchParams({ stops: stops.join(',') }), { signal: controller.signal })
        const value = snapshot || await response.json()
        if (response && !response.ok) throw new Error(value.message || 'No pudimos cargar la ruta vial.')
        if (disposed) return
        const path = value.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude])
        L.polyline(path, { color: '#ffffff', weight: 10, opacity: 0.95, interactive: false }).addTo(map)
        const line = L.polyline(path, { color: '#347a4a', weight: 5, opacity: 1, interactive: false }).addTo(map)
        map.fitBounds(line.getBounds().extend(bounds), { padding: [45, 45], maxZoom: 15 })
        instance.current.bounds = line.getBounds().extend(bounds)
        setRoute(value)
      } catch (problem) {
        if (!disposed && !controller.signal.aborted) setError('Las paradas están marcadas. La ruta por calles no está disponible en este momento.')
      }
    }
    load()
    return () => {
      disposed = true
      controller.abort()
      observer?.disconnect()
      map?.remove()
      instance.current = null
    }
  }, [visible, valid, key, attempt, snapshot])

  function locate() {
    const context = instance.current
    if (!navigator.geolocation || !context) { setLocationMessage('La ubicación no está disponible en este dispositivo.'); return }
    setLocating(true)
    setLocationMessage('')
    navigator.geolocation.getCurrentPosition(position => {
      if (context !== instance.current) return
      const { map, L } = context
      const { latitude, longitude, accuracy } = position.coords
      if (latitude < 3 || latitude > 4 || longitude < -77 || longitude > -76) {
        setLocationMessage('Tu ubicación está fuera del área de Cali. El recorrido sigue visible.')
      } else {
        context.location?.remove()
        context.accuracy?.remove()
        context.accuracy = L.circle([latitude, longitude], { radius: Math.min(accuracy, 10000), color: '#347a4a', weight: 1, fillOpacity: .08 }).addTo(map)
        context.location = L.circleMarker([latitude, longitude], { radius: 8, color: '#fff', weight: 3, fillColor: '#347a4a', fillOpacity: 1 }).addTo(map)
        map.setView([latitude, longitude], 15)
        setLocationMessage('Ubicación aproximada · precisión de ' + Math.ceil(accuracy) + ' m. Solo se muestra en tu dispositivo.')
      }
      setLocating(false)
    }, () => {
      if (context !== instance.current) return
      setLocating(false)
      setLocationMessage('No se pudo obtener tu ubicación. Puedes usar el mapa sin compartirla.')
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 })
  }

  if (!valid) return null
  const destination = selected.at(-1)
  const waze = 'https://www.waze.com/ul?' + new URLSearchParams({ ll: destination.latitude + ',' + destination.longitude, navigate: 'yes', zoom: '15' })
  return (
    <figure className="stop-map road-map" aria-labelledby={title}>
      <div className="geo-heading"><div><span className="geo-eyebrow">Recorrido en Cali</span><h3 id={title}>{mapTitle}</h3></div><span className="geo-badge">{selected.length} paradas</span></div>
      <div className="geo-canvas" ref={host} role="region" aria-label="Mapa interactivo del recorrido" />
      <div className="geo-summary" aria-live="polite">
        {route ? <><strong>{number.format(route.distanceMeters / 1000)} km por vía</strong><span>{Math.ceil(route.durationSeconds / 60)} min aprox. · sin tráfico en tiempo real</span></> : <span>{error || 'Cargando recorrido vial…'}</span>}
        {error && <button type="button" className="secondary" onClick={() => setAttempt(value => value + 1)}>Reintentar mapa</button>}
      </div>
      {tilesFailed && <p className="geo-warning" role="status">No se pudieron cargar algunas calles. Comprueba tu conexión y reintenta el mapa.</p>}
      <div className="geo-actions">
        <button type="button" className="secondary" disabled={!visible} onClick={() => { const value = instance.current; if (value?.bounds) value.map.fitBounds(value.bounds, { padding: [45, 45] }) }}>Ver recorrido completo</button>
        <button type="button" className="secondary" disabled={locating} onClick={locate}>{locating ? 'Buscando ubicación…' : 'Mi ubicación'}</button>
        <a href={waze} target="_blank" rel="noopener noreferrer">Abrir destino en Waze ↗</a>
      </div>
      {locationMessage && <p className="geo-location" role="status">{locationMessage}</p>}
      <ol className="map-stop-strip" aria-label="Paradas en el mapa">{selected.map((stop,index)=><li key={stop.id}><button type="button" className={stop.id===selectedOrigin || stop.id===selectedDestination ? 'selected' : ''} onClick={()=>instance.current?.map.setView([stop.latitude,stop.longitude],16)}><b>{String(index+1).padStart(2,'0')}</b><span>{stop.nombre}</span></button></li>)}</ol>
      <figcaption>{selected.map((stop, index) => `${index + 1}. ${stop.nombre}`).join(' → ')}. La ruta vial es orientativa; las horas y el valor son los fijados en el viaje.</figcaption>
    </figure>
  )
}
