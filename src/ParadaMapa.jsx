import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { localPoint } from '../shared/route-points.js'
import { paradas } from '../shared/paradas.js'

export default function ParadaMapa({ value, onSave, onClose, title = 'Marca el punto de encuentro', submitLabel = 'Usar esta parada' }) {
  const dialog = useRef(null), host = useRef(null), map = useRef(null), marker = useRef(null)
  const [name, setName] = useState(value?.nombre || '')
  const [point, setPoint] = useState(value || null)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current; element.showModal()
    const campus = paradas.find(p => p.id === 'usc')
    const instance = L.map(host.current, { scrollWheelZoom: true }).setView([value?.latitude ?? campus.latitude, value?.longitude ?? campus.longitude], 13)
    map.current = instance
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(instance)
    L.circleMarker([campus.latitude, campus.longitude], { color: '#a97800', fillColor: '#f6ce56', fillOpacity: 1, radius: 8 }).addTo(instance).bindTooltip('Campus USC')
    function mark(point) {
      marker.current?.remove()
      marker.current = L.circleMarker([point.latitude, point.longitude], { radius: 10, weight: 4, color: '#fff', fillColor: '#347a4a', fillOpacity: 1 }).addTo(instance)
    }
    if (value) mark(value)
    instance.on('click', event => {
      const next = { latitude: event.latlng.lat, longitude: event.latlng.lng }
      if (!localPoint(next)) { setError('Elige un punto dentro de Cali.'); return }
      mark(next); setPoint(next); setError('')
    })
    const resize = new ResizeObserver(() => instance.invalidateSize()); resize.observe(host.current)
    return () => { resize.disconnect(); instance.remove(); map.current = null; marker.current = null; element.close() }
  }, [])
  return <dialog ref={dialog} className="point-dialog" aria-labelledby="point-title" onCancel={onClose}>
    <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); if (name.trim().length < 3 || /[<>]/.test(name)) { setError('Escribe un nombre de al menos tres caracteres para la parada.'); return } if (!point) { setError('Toca el mapa para marcar tu parada.'); return }
      onSave({ id: value?.id || 'point-' + crypto.randomUUID(), nombre: name.trim(), latitude: point.latitude, longitude: point.longitude }) }}>
      <header><div><span className="card-eyebrow">Tu recorrido, tus paradas</span><h3 id="point-title">{title}</h3></div><button type="button" className="icon-button secondary" aria-label="Cerrar mapa de parada" onClick={onClose}>×</button></header>
      <label htmlFor="point-name">Nombre de la parada</label><input id="point-name" value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Entrada del parque, junto a la portería" minLength={3} maxLength={80} pattern="[^<>]+" required />
      <p>Toca el mapa donde recogerás o dejarás pasajeros. El punto debe estar dentro de Cali.</p>
      <div className="point-picker-canvas" ref={host} role="region" aria-label="Toca el mapa para elegir la parada" />
      {point && <p className="point-ready" role="status">Punto marcado{ name.trim() ? ': ' + name.trim() : '' }</p>}
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" className="secondary" onClick={onClose}>Volver</button><button disabled={!point}>{submitLabel}</button></footer>
    </form>
  </dialog>
}
