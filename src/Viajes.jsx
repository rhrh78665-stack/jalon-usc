import React, { useEffect, useRef, useState } from 'react'
import CierreViaje from './CierreViaje.jsx'
import { paradas, precioGalonDemo } from '../shared/paradas.js'
import Itinerario, { api, horaLocal, fechaFormulario } from './Itinerario.jsx'

const labels = ['Origen', 'Parada intermedia 1', 'Parada intermedia 2', 'Destino']
const emptyDraft = () => ({
  vehicleId: '', departAt: '', capacity: '', fuelPrice: String(precioGalonDemo),
  stops: labels.map(() => ({ id: '', time: '' })),
})

export default function Viajes({ vehicles }) {
  const [trips, setTrips] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [editing, setEditing] = useState(null)
  const [cancelling, setCancelling] = useState(null)
  const [reason, setReason] = useState('')
  const [series, setSeries] = useState(false)
  const [dates, setDates] = useState([])
  const [nextDate, setNextDate] = useState('')
  const formRef = useRef(null)

  useEffect(() => {
    let controller
    async function loadTrips() {
      controller?.abort()
      controller = new AbortController()
      const current = controller
      try {
        const data = await api('/api/trips/mine', { signal: current.signal })
        if (!current.signal.aborted) setTrips(data)
      } catch (error) {
        if (!current.signal.aborted) setMessage({ error: true, text: error.message })
      }
    }
    loadTrips()
    window.addEventListener('jalon-trips-update', loadTrips)
    return () => {
      controller?.abort()
      window.removeEventListener('jalon-trips-update', loadTrips)
    }
  }, [])

  function resetForm() {
    setDraft(emptyDraft())
    setEditing(null)
    setSeries(false)
    setDates([])
    setNextDate('')
  }

  function editTrip(trip) {
    const stops = labels.map(() => ({ id: '', time: '' }))
    trip.route.forEach((id, index) => {
      const slot = index === trip.route.length - 1 ? 3 : index
      stops[slot] = { id, time: trip.itinerary[index]?.estimatedAt ? fechaFormulario(trip.itinerary[index].estimatedAt) : '' }
    })
    setDraft({
      vehicleId: trip.vehicleId, departAt: fechaFormulario(trip.departAt),
      capacity: String(trip.capacity), fuelPrice: String(trip.pricing?.fuelPriceCopPerGallon ?? precioGalonDemo), stops,
    })
    setEditing(trip.id)
    setSeries(false)
    setDates([])
    setMessage(null)
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    formRef.current?.querySelector('select')?.focus()
  }

  function field(name, value) { setDraft(current => ({ ...current, [name]: value })) }
  function stopField(index, name, value) {
    setDraft(current => ({
      ...current, stops: current.stops.map((stop, slot) => slot === index
        ? { ...stop, [name]: value, ...(name === 'id' && !value ? { time: '' } : {}) } : stop),
    }))
  }

  async function publicar(event) {
    event.preventDefault()
    const selected = draft.stops.map((stop, index) => ({ ...stop, time: index === 0 ? draft.departAt : stop.time })).filter(stop => stop.id)
    if (series && !dates.length) {
      setMessage({ error: true, text: 'Añade al menos una fecha para la serie.' })
      return
    }
    const body = {
      vehicleId: draft.vehicleId, departAt: draft.departAt, capacity: Number(draft.capacity),
      fuelPriceCopPerGallon: Number(draft.fuelPrice), route: selected.map(stop => stop.id),
      stopTimes: selected.map(stop => stop.time), ...(series ? { dates } : {}),
    }
    setSaving(true)
    setMessage(null)
    try {
      const url = editing ? `/api/trips/${encodeURIComponent(editing)}` : series ? '/api/trips/series' : '/api/trips'
      const result = await api(url, {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const saved = Array.isArray(result) ? result : [result]
      setTrips(current => [...(current ?? []).filter(trip => !saved.some(item => item.id === trip.id)), ...saved]
        .sort((a, b) => a.departAt.localeCompare(b.departAt) || a.id.localeCompare(b.id)))
      setMessage({ text: editing ? 'Viaje actualizado.' : series ? `${saved.length} viajes publicados.` : 'Viaje publicado.' })
      resetForm()
      window.dispatchEvent(new Event('jalon-trips-update'))
    } catch (error) {
      setMessage({ error: true, text: error.message })
    } finally {
      setSaving(false)
    }
  }

  async function cancelar(event, tripId) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const saved = await api(`/api/trips/${encodeURIComponent(tripId)}/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
      })
      setTrips(current => current.map(trip => trip.id === saved.id ? saved : trip))
      if (editing === saved.id) resetForm()
      setCancelling(null)
      setReason('')
      setMessage({ text: 'Viaje cancelado. Sus reservas activas también fueron canceladas.' })
      window.dispatchEvent(new Event('jalon-trips-update'))
    } catch (error) {
      setMessage({ error: true, text: error.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="trip-heading">
      <h2 id="trip-heading">Mis viajes</h2>
      {message && <p className={message.error ? 'notice error' : 'notice'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      {trips === null && <p>Cargando viajes…</p>}
      {trips && <>
        {trips.length === 0 && <p>Aún no has publicado viajes.</p>}
        <ul className="trip-list" aria-label="Mis viajes">
          {trips.map(trip => <li key={trip.id}>
            <strong>{horaLocal.format(new Date(trip.departAt))} · {trip.status}</strong>
            <Itinerario trip={trip} />
            <p>{trip.capacity} cupos ofrecidos</p>
            <CierreViaje trip={trip} />
            {trip.cancelReason && <p>Motivo: {trip.cancelReason}</p>}
            {['Programado', 'Lleno'].includes(trip.status) && <>
              <div className="actions">
                <button type="button" className="secondary" disabled={saving || new Date(trip.departAt) <= new Date()} onClick={() => editTrip(trip)}>Editar viaje</button>
                <button type="button" className="secondary" disabled={saving} onClick={() => { setCancelling(trip.id); setReason('') }}>Cancelar viaje</button>
              </div>
              {cancelling === trip.id && <form onSubmit={event => cancelar(event, trip.id)}>
                <label htmlFor={`cancel-${trip.id}`}>Motivo de cancelación</label>
                <textarea id={`cancel-${trip.id}`} value={reason} onChange={event => setReason(event.target.value)} maxLength={500} required disabled={saving} />
                <small>Al confirmar, este viaje saldrá de la búsqueda y sus reservas activas se cancelarán.</small>
                <div className="actions">
                  <button className="danger" disabled={saving}>Confirmar cancelación</button>
                  <button type="button" className="secondary" disabled={saving} onClick={() => setCancelling(null)}>Volver</button>
                </div>
              </form>}
            </>}
          </li>)}
        </ul>
        <h3>{editing ? 'Editar viaje' : 'Publicar viaje'}</h3>
        <p className="demo-note">Catálogo de demostración: distancias ficticias y precio de combustible de prueba.</p>
        {editing && <p>Los cambios solo se guardan si el viaje no tiene reservas pendientes ni confirmadas.</p>}
        <form ref={formRef} onSubmit={publicar} aria-busy={saving}>
          <fieldset disabled={saving}>
            <legend>Datos de salida</legend>
            <label htmlFor="trip-vehicle">Vehículo</label>
            <select id="trip-vehicle" value={draft.vehicleId} onChange={event => field('vehicleId', event.target.value)} required>
              <option value="">Selecciona un vehículo</option>
              {vehicles.map(({ id, plate, seats }) => <option key={id} value={id}>{plate} · {seats} asientos</option>)}
            </select>
            <label htmlFor="trip-departure">Salida (hora de Cali)</label>
            <input id="trip-departure" type="datetime-local" value={draft.departAt}
              onInput={event => field('departAt', event.target.value)} onChange={event => field('departAt', event.target.value)} required />
            <label htmlFor="trip-capacity">Cupos ofrecidos</label>
            <input id="trip-capacity" type="number" min="1" step="1" value={draft.capacity} onChange={event => field('capacity', event.target.value)} required />
            <label htmlFor="trip-fuel">Precio del galón (COP)</label>
            <input id="trip-fuel" type="number" min="1" step="1" value={draft.fuelPrice} onChange={event => field('fuelPrice', event.target.value)} required />
          </fieldset>
          <p>Selecciona las paradas en orden, con la USC en un extremo. Las horas deben aumentar en cada parada.</p>
          {labels.map((label, index) => {
            const required = index === 0 || index === 3
            const stop = draft.stops[index]
            return <fieldset key={label} disabled={saving}>
              <legend>{label}</legend>
              <label htmlFor={`trip-stop-${index}`}>Parada</label>
              <select id={`trip-stop-${index}`} value={stop.id} onChange={event => stopField(index, 'id', event.target.value)} required={required}>
                <option value="">{required ? 'Selecciona una parada' : 'Sin parada intermedia'}</option>
                {paradas.map(({ id, nombre }) => <option key={id} value={id}
                  disabled={draft.stops.some((item, slot) => slot !== index && item.id === id)}>{nombre}</option>)}
              </select>
              <label htmlFor={`trip-stop-${index}-time`}>{index === 0 ? 'Hora de salida del origen' : 'Hora estimada'}</label>
              <input id={`trip-stop-${index}-time`} type="datetime-local"
                value={index === 0 ? draft.departAt : stop.time} readOnly={index === 0}
                disabled={!stop.id} required={Boolean(stop.id)}
                onInput={event => stopField(index, 'time', event.target.value)}
                onChange={event => stopField(index, 'time', event.target.value)} />
            </fieldset>
          })}
          {!editing && <fieldset disabled={saving}>
            <legend>Repetir en otras fechas</legend>
            <label htmlFor="trip-series">Tipo de publicación</label>
            <select id="trip-series" value={series ? 'series' : 'single'} onChange={event => setSeries(event.target.value === 'series')}>
              <option value="single">Un solo viaje</option>
              <option value="series">Una serie de viajes</option>
            </select>
            {series && <>
              <p>Se publicará un viaje por cada fecha de la lista, con las mismas horas y duración. Si una fecha no es válida, no se guarda ninguno.</p>
              <label htmlFor="series-date">Fecha para añadir</label>
              <input id="series-date" type="date" value={nextDate}
                onInput={event => setNextDate(event.target.value)} onChange={event => setNextDate(event.target.value)} />
              <button type="button" className="secondary" disabled={!nextDate || dates.includes(nextDate) || dates.length >= 30}
                onClick={() => { setDates(current => [...current, nextDate].sort()); setNextDate('') }}>Añadir fecha</button>
              <ul className="date-list">{dates.map(date => <li key={date}>
                {date} <button type="button" className="secondary" aria-label={`Quitar fecha ${date}`}
                  onClick={() => setDates(current => current.filter(value => value !== date))}>Quitar</button>
              </li>)}</ul>
            </>}
          </fieldset>}
          <button disabled={saving}>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : series ? 'Publicar serie' : 'Publicar viaje'}</button>
          {editing && <button type="button" className="secondary" disabled={saving} onClick={resetForm}>Salir de edición</button>}
        </form>
      </>}
    </section>
  )
}
