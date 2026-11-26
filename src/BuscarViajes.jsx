import { loadPublishedOffers } from './catalogue-api.js'
import React, { useEffect, useRef, useState } from 'react'
import VehicleSummary from './VehicleSummary.jsx'
import OfertaDetalle from './OfertaDetalle.jsx'
import MapaOfertas from './MapaOfertas.jsx'
import { pointName } from '../shared/route-points.js'
import { groupPublishedRoutes, publishedStopList } from '../shared/catalogo.js'
import { api, pesos } from './Itinerario.jsx'
import { PageHeading, tripDate } from './Inicio.jsx'

const time = new Intl.DateTimeFormat('es-CO',{hour:'numeric',minute:'2-digit',timeZone:'America/Bogota'})
export default function BuscarViajes({ initialView='list', initialTrip=null }) {
  const [date,setDate]=useState(tripDate)
  const [mode,setMode]=useState(initialView)
  const [result,setResult]=useState(null)
  const [routeFilter,setRouteFilter]=useState('')
  const [stopFilter,setStopFilter]=useState('')
  const [sort,setSort]=useState('departure')
  const [page,setPage]=useState(1)
  const [detail,setDetail]=useState(null)
  const [loadingDetail,setLoadingDetail]=useState(null)
  const [busy,setBusy]=useState(false)
  const [requesting,setRequesting]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [revision,setRevision]=useState(0)
  const detailRequest=useRef(null)
  useEffect(()=>setMode(initialView),[initialView])
  useEffect(()=>{
    const refresh=()=>setRevision(value=>value+1)
    window.addEventListener('jalon-trips-update',refresh)
    return()=>{window.removeEventListener('jalon-trips-update',refresh);detailRequest.current?.abort()}
  },[])
  useEffect(()=>{
    const controller=new AbortController()
    setBusy(true);setError('')
    loadPublishedOffers(date,controller.signal)
      .then(data=>{if(!controller.signal.aborted)setResult({...data,date})})
      .catch(failure=>{if(!controller.signal.aborted){setError(failure.message);setResult(null)}})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false)})
    return()=>controller.abort()
  },[date,revision])
  useEffect(()=>{setRouteFilter('');setStopFilter('');setPage(1)},[date])
  useEffect(()=>{if(initialTrip)consultar(initialTrip)},[initialTrip?.id])
  async function consultar(trip) {
    detailRequest.current?.abort()
    const controller=new AbortController();detailRequest.current=controller
    setLoadingDetail(trip.id);setError('')
    try {
      const origin=trip.route[0],destination=trip.route.at(-1)
      const data=await api('/api/trips/'+encodeURIComponent(trip.id)+'?'+new URLSearchParams({origin,destination}),{signal:controller.signal})
      if(!controller.signal.aborted)setDetail({...data,origin,destination})
    }catch(failure){if(!controller.signal.aborted)setError(failure.message)}
    finally{if(!controller.signal.aborted)setLoadingDetail(null)}
  }
  async function reservar(selection) {
    setRequesting(true)
    try {
      await api('/api/trips/'+encodeURIComponent(selection.id)+'/reservations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin:selection.origin,destination:selection.destination})})
      setDetail(null);setNotice('Reserva enviada al conductor. Consulta su confirmación en Reservas.')
      window.dispatchEvent(new Event('jalon-reservas-update'))
    }finally{setRequesting(false)}
  }
  const offers=result?.date===date ? result.items : []
  const routes=groupPublishedRoutes(offers), stops=publishedStopList(offers)
  const filtered=offers.filter(trip=>(!routeFilter || trip.route.join('|')===routeFilter) && (!stopFilter || trip.route.includes(stopFilter)))
    .sort((a,b)=>(sort==='price'?a.maximumCop-b.maximumCop:sort==='seats'?b.availableSeats-a.availableSeats:0)||Date.parse(a.boardAt)-Date.parse(b.boardAt))
  const displayed=mode==='map'?filtered:filtered.slice((page-1)*24,page*24)
  return <section className="catalogue-page" aria-labelledby="routes-heading">
    <PageHeading id="routes-heading" eyebrow="Recorridos publicados por conductores" title="Tu próximo asiento ya tiene ruta." aside={<span className="availability-seal"><span className="status-dot"/>{result?filtered.length+' ofertas disponibles':'Consultando disponibilidad'}</span>}>Consulta las salidas, conoce sus paradas y reserva dentro del recorrido que mejor te sirve.</PageHeading>
    <div className="catalogue-controls">
      <div className="day-switch" aria-label="Fecha de los viajes">{[['Mañana',tripDate(1)],['Pasado mañana',tripDate(2)]].map(([label,value])=><button type="button" key={value} aria-pressed={date===value} onClick={()=>setDate(value)}>{label}</button>)}</div>
      <label className="catalogue-date">Otra fecha<input id="search-date" type="date" value={date} onChange={event=>setDate(event.target.value)} required/></label>
      <div className="section-subtabs view-switch" aria-label="Vistas de rutas">{[['list','Disponibles'],['map','Mapa'],['stops','Paradas']].map(([value,label])=><button type="button" key={value} aria-pressed={mode===value} onClick={()=>setMode(value)}>{label}</button>)}</div>
    </div>
    <div className="route-catalogue-filter"><label>Recorridos disponibles<select id="published-route" value={routeFilter} onChange={event=>{setRouteFilter(event.target.value);setPage(1)}}><option value="">Todos los recorridos publicados</option>{routes.map(route=><option key={route.key} value={route.key}>{pointName(route.offers[0],route.route[0])+' → '+pointName(route.offers[0],route.route.at(-1))+' · '+route.itinerary.length+' paradas · '+route.offers.length+' ofertas'}</option>)}</select></label><label>Ordenar ofertas<select id="offer-sort" value={sort} onChange={event=>{setSort(event.target.value);setPage(1)}}><option value="departure">Hora de salida</option><option value="price">Menor valor</option><option value="seats">Más asientos disponibles</option></select></label></div>
    {stopFilter && <div className="active-route-filter"><span>Ofertas que pasan por {stops.find(stop=>stop.stopId===stopFilter)?.name}</span><button type="button" className="secondary" onClick={()=>setStopFilter('')}>Quitar filtro ×</button></div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {error && <div className="notice error" role="alert"><p>{error}</p><button type="button" className="secondary" onClick={()=>setRevision(value=>value+1)}>Reintentar</button></div>}
    {busy && !result && <div className="offer-skeletons" role="status" aria-label="Cargando rutas">{[0,1,2].map(i=><div key={i}><span/><span/><span/></div>)}</div>}
    {result && <div aria-busy={busy}>
      <div className="catalogue-result-heading"><p className="board-count"><strong>{filtered.length}</strong> ofertas <span>· {routes.length} recorridos publicados</span></p><span>La ruta la define el conductor. Tú eliges entre sus paradas.</span></div>
      {mode==='stops' ? <div className="published-stops-grid">{stops.map((stop,index)=><button type="button" key={stop.stopId} data-stop-id={stop.stopId} onClick={()=>{setStopFilter(stop.stopId);setPage(1);setMode('list')}}><span className="stop-number">{String(index+1).padStart(2,'0')}</span><div><strong>{stop.name}</strong><small>{stop.offers.size} ofertas pasan por aquí</small></div><span aria-hidden="true">↗</span></button>)}</div> : <div className={'market-layout'+(mode==='map'?' map-layout':'')}>
        {mode==='map' && <aside className="offers-map-pane"><MapaOfertas trips={filtered} onSelect={consultar}/></aside>}
        <ul className="search-results" aria-label="Resultados de viajes" aria-live="polite">
          {displayed.map(trip=><li className="offer-card" data-trip-id={trip.id} key={trip.id}>
            <VehicleSummary trip={trip}/>
            <div className="offer-route-content"><div className="offer-route-meta"><span>{trip.itinerary.length} paradas</span><span>{trip.distanceKm?.toLocaleString('es-CO',{maximumFractionDigits:1})} km</span></div>
              <div className="result-route"><div><span className="route-endpoint"/><div><strong>{pointName(trip,trip.route[0])}</strong><time dateTime={trip.boardAt}>{time.format(new Date(trip.boardAt))}</time></div></div><div><span className="route-endpoint route-arrival"/><div><strong>{pointName(trip,trip.route.at(-1))}</strong><time dateTime={trip.alightAt}>{time.format(new Date(trip.alightAt))}</time></div></div></div>
              <div className="journey-price"><div><small>Recorrido completo</small><strong>{pesos.format(trip.maximumCop)}</strong></div><span>Por asiento</span></div>
              <div className="result-footer"><span className="seat-count"><span className="status-dot"/>{trip.availableSeats} {trip.availableSeats===1?'asiento libre':'asientos libres'}</span><button type="button" className="glass-button" disabled={busy || loadingDetail===trip.id} onClick={()=>consultar(trip)}>{loadingDetail===trip.id?'Abriendo…':'Ver paradas'} <span aria-hidden="true">↗</span></button></div>
            </div>
          </li>)}
        </ul>
      </div>}
      {!filtered.length && !busy && <div className="empty-results"><h3>No hay ofertas con estos filtros.</h3><p>Prueba otra fecha o consulta todos los recorridos publicados.</p><button type="button" className="secondary" onClick={()=>{setRouteFilter('');setStopFilter('')}}>Ver todos los recorridos</button></div>}
      {mode==='list' && filtered.length>24 && <nav className="pagination" aria-label="Páginas de viajes"><button type="button" className="secondary" disabled={page===1} onClick={()=>setPage(value=>value-1)}>← Anterior</button><span>{page} / {Math.ceil(filtered.length/24)}</span><button type="button" className="secondary" disabled={page*24>=filtered.length} onClick={()=>setPage(value=>value+1)}>Siguiente →</button></nav>}
    </div>}
    {detail && <OfertaDetalle trip={detail} requesting={requesting} onClose={()=>setDetail(null)} onRequest={reservar}/>}
  </section>
}
