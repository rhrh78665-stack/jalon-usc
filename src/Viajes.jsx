import React, { useEffect, useRef, useState } from 'react'
import ParadaMapa from './ParadaMapa.jsx'
import MapaParadas from './MapaParadas.jsx'
import { itineraryPoints, pointName } from '../shared/route-points.js'
import CierreViaje from './CierreViaje.jsx'
import { paradas, precioGalonDemo } from '../shared/paradas.js'
import Itinerario, { api, horaLocal, fechaFormulario, pesos } from './Itinerario.jsx'

const emptyDraft = () => ({
  vehicleId: '', departAt: '', capacity: '', fuelPrice: String(precioGalonDemo),
  stops: [{id:'',time:''},{id:'',time:''}],
})

export default function Viajes({ vehicles, composeSignal, initialStatus='active', navigationId, composeRequested }) {
  const [statusFilter,setStatusFilter]=useState(initialStatus || 'active')
  useEffect(()=>{setStatusFilter(initialStatus || 'active');if(!composeRequested)setCompose(false)},[initialStatus,navigationId,composeRequested])
  const [trips, setTrips] = useState(null)
  const [tarifa, setTarifa] = useState(null)
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
  const [picker, setPicker] = useState(null)
  const [compose, setCompose] = useState(false)
  const [plan,setPlan]=useState(null)
  const [planning,setPlanning]=useState(false)
  useEffect(()=>{if(composeSignal){resetForm();setCompose(true)}},[composeSignal])

  useEffect(() => {
    const controller = new AbortController()
    api('/api/trips/tarifa', { signal: controller.signal }).then(setTarifa)
      .catch(error => {
        if (!controller.signal.aborted) setMessage({ error: true, text: error.message })
      })
    return () => controller.abort()
  }, [])

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
    setPlan(null)
    setEditing(null)
    setSeries(false)
    setDates([])
    setNextDate('')
  }

  function editTrip(trip) {
    const stops = trip.route.map((id,index)=>({id,point:itineraryPoints(trip).find(p=>p.id===id && !paradas.some(k=>k.id===id)),time:trip.itinerary[index]?.estimatedAt ? fechaFormulario(trip.itinerary[index].estimatedAt) : ''}))
    setDraft({
      vehicleId: trip.vehicleId, departAt: fechaFormulario(trip.departAt),
      capacity: String(trip.capacity), fuelPrice: String(trip.pricing?.fuelPriceCopPerGallon ?? precioGalonDemo), stops,
    })
    setCompose(true)
    setEditing(trip.id)
    setSeries(false)
    setDates([])
    setMessage(null)
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    formRef.current?.querySelector('select')?.focus()
  }

  useEffect(() => {
    if (vehicles.length === 1 && !draft.vehicleId) setDraft(current => ({ ...current, vehicleId: vehicles[0].id }))
  }, [vehicles, draft.vehicleId])

  function direction(outbound) {
    setDraft(current => ({ ...current, stops: current.stops.map((stop,index) => {
      if (index === (outbound ? 0 : current.stops.length-1)) return { id: 'usc', time: stop.time }
      return stop.id === 'usc' ? { id: '', time: '' } : stop
    }) }))
  }

  function field(name, value) { setDraft(current => ({ ...current, [name]: value })) }
  function stopField(index, name, value) {
    if(name==='id')setPlan(null)
    setDraft(current => ({
      ...current, stops: current.stops.map((stop, slot) => slot === index
        ? { ...stop, [name]: value, ...(name === 'id' ? { point: null, ...(!value ? { time: '' } : {}) } : {}) } : stop),
    }))
  }

  async function preview() {
    const chosen=draft.stops.filter(s=>s.id)
    if(chosen.length!==draft.stops.length){setMessage({error:true,text:'Elige un punto para cada parada antes de calcular la ruta.'});return null}
    setPlanning(true);setMessage(null)
    try {
      const next=await api('/api/journeys/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({route:chosen.map(s=>s.id),routePoints:chosen.map(s=>s.point).filter(Boolean)})})
      setPlan(next)
      if(draft.departAt){let elapsed=0;setDraft(current=>({...current,stops:current.stops.map((stop,index)=>{if(index)elapsed+=next.roadMap?Math.max(2,Math.ceil(next.roadMap.legs[index-1].durationSeconds/60))+2:10;return {...stop,time:fechaFormulario(new Date(new Date(current.departAt+':00-05:00').getTime()+elapsed*60000))}})}))}
      return next
    }catch(error){setMessage({error:true,text:error.message});return null}finally{setPlanning(false)}
  }

  async function publicar(event) {
    event.preventDefault()
    const selected = draft.stops.map((stop, index) => ({ ...stop, time: index === 0 ? draft.departAt : stop.time })).filter(stop => stop.id)
    if (series && !dates.length) {
      setMessage({ error: true, text: 'Añade al menos una fecha para la serie.' })
      return
    }
    if(!plan || Date.parse(plan.expiresAt)<=Date.now()){setMessage({error:true,text:'Calcula y revisa el recorrido antes de publicarlo.'});return}
    const body = {
      planId:plan.id,
      vehicleId: draft.vehicleId, departAt: draft.departAt, capacity: Number(draft.capacity),
      fuelPriceCopPerGallon: Number(draft.fuelPrice), route: selected.map(stop => stop.id),
      stopTimes: selected.map(stop => stop.time), routePoints: selected.map(stop => stop.point).filter(Boolean), ...(series ? { dates } : {}),
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
      <header className="section-heading"><span className="card-eyebrow">Tu espacio como conductor</span><h2 id="trip-heading">Mis ofertas</h2><p>Publica tu destino, define tus paradas y comparte los asientos que tienes disponibles.</p></header>
      <div className="composer-switch"><button type="button" className={!compose ? '' : 'secondary'} onClick={() => setCompose(false)}>Mis ofertas</button><button type="button" className={compose ? '' : 'secondary'} onClick={() => { resetForm(); setCompose(true) }}>Publicar recorrido <span aria-hidden="true">↗</span></button></div>
      {message && <p className={message.error ? 'notice error' : 'notice'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      {trips === null && <p>Cargando viajes…</p>}
      {trips && <>
        {trips.length === 0 && <p>Aún no has publicado viajes.</p>}
        {!compose && <><div className="section-subtabs" aria-label="Estado de mis carreras"><button type="button" aria-pressed={statusFilter==='active'} onClick={()=>setStatusFilter('active')}>Ofertas activas</button><button type="button" aria-pressed={statusFilter==='EnCurso'} onClick={()=>setStatusFilter('EnCurso')}>En curso</button></div><p className="tariff-note">Las carreras finalizadas y canceladas se conservan en Historial de carreras.</p></>}
        {!compose && <ul className="trip-list" aria-label="Mis viajes">
          {trips.filter(trip=>statusFilter==='EnCurso'?trip.status==='EnCurso':['Programado','Lleno','EnCurso'].includes(trip.status)).map(trip => <li key={trip.id}>
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
        </ul>}
        <div hidden={!compose} className="journey-composer"><h3>{editing ? 'Editar viaje' : 'Publicar viaje'}</h3>
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
            {tarifa ? (
              <p>Precio del galón: {pesos.format(editing ? Number(draft.fuelPrice) : tarifa.fuelPriceCopPerGallon)}</p>
            ) : (
              <>
                <label htmlFor="trip-fuel">Precio por galón (COP)</label>
                <input id="trip-fuel" type="number" min="1" step="1" value={draft.fuelPrice} onChange={event => field('fuelPrice', event.target.value)} required />
              </>
            )}
          </fieldset>
          <header className="route-editor-heading"><span className="card-eyebrow">Paradas del conductor</span><h3>Así será tu recorrido</h3><p>Elige origen y destino. Añade hasta diez paradas y ubícalas en el mapa, en el orden en que pasarás por ellas. Tu recorrido puede comenzar y terminar en cualquier punto de Cali.</p></header>
          <div className="route-direction"><button type="button" className="secondary" aria-pressed={draft.stops.at(-1).id === 'usc'} onClick={() => {setPlan(null);direction(false)}}>Hacia el campus</button><button type="button" className="secondary" aria-pressed={draft.stops[0].id === 'usc'} onClick={() => {setPlan(null);direction(true)}}>Desde el campus</button></div>
          {draft.stops.map((stop, index) => {
            const required = true
            const label = index===0 ? 'Origen' : index===draft.stops.length-1 ? 'Destino' : 'Parada '+index
            return <fieldset key={index} className="route-stop-editor" disabled={saving || planning}>
              <legend><b>{String(index+1).padStart(2,'0')}</b> {label}</legend>
              <div className="stop-order-actions"><button type="button" className="secondary" disabled={!index} aria-label={'Subir parada '+(index+1)} onClick={()=>{setPlan(null);setDraft(c=>{const stops=[...c.stops];[stops[index-1],stops[index]]=[stops[index],stops[index-1]];return {...c,stops}})}}>↑</button><button type="button" className="secondary" disabled={index===draft.stops.length-1} aria-label={'Bajar parada '+(index+1)} onClick={()=>{setPlan(null);setDraft(c=>{const stops=[...c.stops];[stops[index],stops[index+1]]=[stops[index+1],stops[index]];return {...c,stops}})}}>↓</button><button type="button" className="secondary" disabled={draft.stops.length<=2} aria-label={'Quitar parada '+(index+1)} onClick={()=>{setPlan(null);setDraft(c=>({...c,stops:c.stops.filter((_,i)=>i!==index)}))}}>Quitar</button></div>
              <label htmlFor={`trip-stop-${index}`}>Parada</label>
              <select id={`trip-stop-${index}`} value={stop.id} onChange={event => stopField(index, 'id', event.target.value)} required={required}>
                <option value="">{required ? 'Selecciona una parada' : 'Sin parada intermedia'}</option>
                {stop.point && <option value={stop.point.id}>{stop.point.nombre}</option>}
                {paradas.map(({ id, nombre }) => <option key={id} value={id}
                  disabled={draft.stops.some((item, slot) => slot !== index && item.id === id)}>{nombre}</option>)}
              </select>
              <button type="button" className="secondary point-picker-button" onClick={() => setPicker(index)}>{stop.point ? 'Cambiar punto en el mapa' : 'Marcar mi parada en el mapa'}</button>
              <label htmlFor={`trip-stop-${index}-time`}>{index === 0 ? 'Hora de salida del origen' : 'Hora estimada'}</label>
              <input id={`trip-stop-${index}-time`} type="datetime-local"
                value={index === 0 ? draft.departAt : stop.time} readOnly={index === 0}
                disabled={!stop.id} required={Boolean(stop.id)}
                onInput={event => stopField(index, 'time', event.target.value)}
                onChange={event => stopField(index, 'time', event.target.value)} />
            </fieldset>
          })}
          <div className="route-editor-actions"><button type="button" className="secondary" disabled={draft.stops.length>=10 || saving || planning} onClick={()=>{setPlan(null);setDraft(c=>({...c,stops:[...c.stops.slice(0,-1),{id:'',time:''},c.stops.at(-1)]}))}}>+ Añadir parada ({draft.stops.length}/10)</button><button type="button" disabled={saving || planning || draft.stops.some(s=>!s.id)} onClick={preview}>{planning?'Trazando recorrido…':'Calcular y revisar recorrido'}</button></div>
          {plan && <><p className="route-plan-summary">{plan.distanceKm.toLocaleString('es-CO',{maximumFractionDigits:1})} km · {draft.stops.length} paradas · {plan.source==='road'?'Recorrido por calles':'Distancia estimada; ruta por calles no disponible'}. Revisa los horarios antes de publicar.</p><MapaParadas snapshot={plan.roadMap} title="Tu recorrido, parada a parada" stops={draft.stops.map(stop=>stop.id)} points={draft.stops.map(stop=>stop.point).filter(Boolean)} /></>}
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
          <button disabled={saving || planning || !plan}>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : series ? 'Publicar serie' : 'Publicar viaje'}</button>
          {editing && <button type="button" className="secondary" disabled={saving} onClick={resetForm}>Salir de edición</button>}
        </form></div>
      </>}
      {picker !== null && <ParadaMapa value={draft.stops[picker].point} onClose={() => setPicker(null)} onSave={point => { setPlan(null);setDraft(current => ({ ...current, stops: current.stops.map((stop, index) => index === picker ? { ...stop, id: point.id, point } : stop) })); setPicker(null) }} />}
    </section>
  )
}
