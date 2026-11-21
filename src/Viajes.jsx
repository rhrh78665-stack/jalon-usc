import React, { useEffect, useState } from 'react'
import { paradas } from '../shared/paradas.js'

const nombreParada = Object.fromEntries(paradas.map(({ id, nombre }) => [id, nombre]))
const horaLocal = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Bogota',
})

export default function Viajes({ vehicles }) {
  const [trips, setTrips] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadTrips() {
      try {
        const response = await fetch('/api/trips/mine', { signal: controller.signal })
        if (!response.ok) throw new Error()
        setTrips(await response.json())
      } catch {
        if (!controller.signal.aborted) {
          setMessage({ error: true, text: 'No se pudieron cargar tus viajes.' })
        }
      }
    }

    loadTrips()
    return () => controller.abort()
  }, [])

  async function publicar(event) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const route = data.getAll('route').filter(Boolean)
    setSaving(true)
    setMessage(null)

    try {
      const response = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: data.get('vehicleId'),
          departAt: data.get('departAt'),
          capacity: Number(data.get('capacity')),
          route,
        }),
      })
      const result = await response.json()

      if (!response.ok) {
        setMessage({ error: true, text: result.message })
        return
      }

      form.reset()
      setTrips(current => [...current, result].sort((a, b) => a.departAt.localeCompare(b.departAt)))
      setMessage({ text: 'Viaje publicado.' })
    } catch {
      setMessage({ error: true, text: 'No se pudo publicar el viaje. Inténtalo de nuevo.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="trip-heading">
      <h2 id="trip-heading">Publicar viaje</h2>
      {trips && (
        <>
          {trips.length > 0 && (
            <ul aria-label="Mis viajes">
              {trips.map(trip => (
                <li key={trip.id}>
                  {trip.route.map(id => nombreParada[id]).join(' → ')}
                  {' · '}{horaLocal.format(new Date(trip.departAt))}
                  {' · '}{trip.capacity} cupos{' · '}{trip.status}
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={publicar} aria-busy={saving}>
            <label htmlFor="trip-vehicle">Vehículo</label>
            <select id="trip-vehicle" name="vehicleId" defaultValue="" required>
              <option value="">Selecciona un vehículo</option>
              {vehicles.map(({ id, plate, seats }) => (
                <option key={id} value={id}>{plate} · {seats} asientos</option>
              ))}
            </select>

            <label htmlFor="trip-departure">Salida (hora de Cali)</label>
            <input id="trip-departure" name="departAt" type="datetime-local" required />

            <label htmlFor="trip-capacity">Cupos ofrecidos</label>
            <input id="trip-capacity" name="capacity" type="number" min="1" step="1" required />

            {['Origen', 'Parada intermedia 1', 'Parada intermedia 2', 'Destino'].map((label, index) => {
              const required = index === 0 || index === 3
              return (
                <React.Fragment key={label}>
                  <label htmlFor={`trip-stop-${index}`}>{label}</label>
                  <select id={`trip-stop-${index}`} name="route" defaultValue="" required={required}>
                    <option value="">{required ? 'Selecciona una parada' : 'Sin parada intermedia'}</option>
                    {paradas.map(({ id, nombre }) => <option key={id} value={id}>{nombre}</option>)}
                  </select>
                </React.Fragment>
              )
            })}

            <button disabled={saving}>{saving ? 'Publicando…' : 'Publicar viaje'}</button>
          </form>
        </>
      )}
      {message && (
        <p className={message.error ? 'notice error' : 'notice'}
          role={message.error ? 'alert' : 'status'}>{message.text}</p>
      )}
    </section>
  )
}
