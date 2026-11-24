import React, { useState } from 'react'
import { paradas } from '../shared/paradas.js'
import { api } from './Itinerario.jsx'

export default function ParadasCercanas({ onSelect }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [point, setPoint] = useState({ latitude: paradas[0].latitude, longitude: paradas[0].longitude })
  const [radius, setRadius] = useState(800)

  async function search(location = point) {
    setBusy(true)
    setError('')
    try {
      const rows = await api('/api/stops/nearby?' + new URLSearchParams({ ...location, radius }))
      setItems(rows)
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  function locate() {
    setError('')
    if (!navigator.geolocation) { setError('Tu navegador no ofrece ubicación. Usa una referencia del catálogo.'); return }
    setBusy(true)
    navigator.geolocation.getCurrentPosition(position => {
      const location = { latitude: position.coords.latitude, longitude: position.coords.longitude }
      setPoint(location)
      search(location)
    }, () => { setBusy(false); setError('No se pudo obtener tu ubicación. Puedes usar una referencia del catálogo.') },
    { timeout: 10000, maximumAge: 60000 })
  }

  return (
    <details className="nearby-stops">
      <summary>Encontrar una parada cercana</summary>
      <p>Selecciona una referencia o comparte tu ubicación para consultar las paradas dentro del radio.</p>
      <label>Referencia del catálogo<select defaultValue={paradas[0].id} onChange={event => {
        const stop = paradas.find(item => item.id === event.target.value)
        setPoint({ latitude: stop.latitude, longitude: stop.longitude })
        setItems(null)
      }}>{paradas.map(stop => <option value={stop.id} key={stop.id}>{stop.nombre}</option>)}</select></label>
      <div className="coordinate-fields">
        <label>Latitud<input type="number" min="-90" max="90" step="any" value={point.latitude}
          onChange={event => setPoint(value => ({ ...value, latitude: event.target.value }))} /></label>
        <label>Longitud<input type="number" min="-180" max="180" step="any" value={point.longitude}
          onChange={event => setPoint(value => ({ ...value, longitude: event.target.value }))} /></label>
        <label>Radio en metros<input type="number" min="0" max="5000" step="1" value={radius}
          onChange={event => setRadius(event.target.value)} /></label>
      </div>
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => search()}>Buscar paradas cercanas</button>
        <button type="button" className="secondary" disabled={busy} onClick={locate}>Usar mi ubicación</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {items?.length === 0 && <p>No hay paradas dentro del radio indicado.</p>}
      <ul>{items?.map(stop => <li key={stop.id}>
        {stop.nombre} · {Math.round(stop.distanceMeters)} m
        <button className="secondary" type="button" onClick={() => onSelect(stop.id)}>Usar como subida</button>
      </li>)}</ul>
    </details>
  )
}
