import InicioGestion from './InicioGestion.jsx'
import { loadPublishedOffers } from './catalogue-api.js'
import React, { useEffect, useRef, useState } from 'react'
import { api, pesos, fechaFormulario } from './Itinerario.jsx'
import { pointName } from '../shared/route-points.js'
import { groupPublishedRoutes } from '../shared/catalogo.js'
import VehicleSummary from './VehicleSummary.jsx'

export const tripDate = (days = 1) => fechaFormulario(new Date(Date.now() + days * 86400000)).slice(0, 10)

export function PageHeading({ eyebrow, title, children, aside, id }) {
  return <header className="page-heading"><div>{eyebrow && <span className="card-eyebrow">{eyebrow}</span>}<h2 id={id}>{title}</h2>{children && <p>{children}</p>}</div>{aside}</header>
}

export default function Inicio(props) {
  return props.session?.driver || props.session?.mobility ? <InicioGestion session={props.session} onNavigate={props.onNavigate}/> : <InicioComunidad {...props}/>
}
function InicioComunidad({ session, onNavigate, onAccess }) {
  const [offers,setOffers] = useState(null)
  const [error,setError] = useState('')
  const rail = useRef(null)
  useEffect(() => {
    if (!session || session.mobility) return
    const controller = new AbortController()
    loadPublishedOffers(tripDate(),controller.signal)
      .then(data=>{if(!controller.signal.aborted)setOffers(data)})
      .catch(failure=>{if(!controller.signal.aborted)setError(failure.message)})
    return()=>controller.abort()
  },[session?.userId,session?.email,session?.mobility])
  const routes = groupPublishedRoutes(offers?.items || [])
  const explore = () => session ? onNavigate(session.mobility?'movilidad':'rutas',{mode:'list'}) : onAccess('login')
  return <section className="home-page" aria-labelledby="home-heading">
    <div className="landing-hero">
      <div className="landing-copy"><span className="card-eyebrow">Movilidad universitaria · Cali</span><h1 id="home-heading">Un camino<br/>compartido.<br/><em>Un lugar para ti.</em></h1><p>Los conductores publican sus rutas y horarios.<br/>Tú eliges un asiento y las paradas de ese recorrido.</p><div className="hero-actions"><button className="primary" type="button" onClick={explore}>{session?.mobility?'Abrir administración':'Ver rutas disponibles'} <span aria-hidden="true">↗</span></button><a className="glass-button" href="#como-funciona">Cómo funciona <span aria-hidden="true">↓</span></a></div><div className="hero-note"><span className="status-dot" /> Recorridos definidos · Reservas por parada</div></div>
      <div className="landing-art"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><img src="/jalon-logo.webp" alt="Un conductor comparte su recorrido en un carro verde" width="720" height="720" fetchPriority="high"/><div className="floating-route"><span className="route-dot"/><div><strong>Tu ruta ya tiene un camino</strong><span>Consulta sus paradas antes de reservar</span></div><span aria-hidden="true">↗</span></div></div>
    </div>
    <div className="home-strip"><span>Rutas publicadas</span><i aria-hidden="true">✳</i><span>Conductores de tu comunidad</span><i aria-hidden="true">✳</i><span>Asientos disponibles</span><i aria-hidden="true">✳</i><span>Paradas definidas</span></div>
    {session && !session.mobility && <section className="home-departures" aria-labelledby="departures-heading">
      <header className="section-heading-row"><div><span className="card-eyebrow">Organiza tu próximo recorrido</span><h2 id="departures-heading">Mañana hay lugar.</h2><p>{offers ? offers.total+' ofertas en '+routes.length+' recorridos publicados.' : 'Consultando las próximas salidas…'}</p></div><div className="carousel-controls"><button type="button" className="round-button" aria-label="Ofertas anteriores" onClick={()=>rail.current?.scrollBy({left:-420,behavior:'smooth'})}>←</button><button type="button" className="round-button" aria-label="Ofertas siguientes" onClick={()=>rail.current?.scrollBy({left:420,behavior:'smooth'})}>→</button></div></header>
      {error && <p className="notice error" role="alert">{error}</p>}
      <ul className="home-offer-rail" ref={rail}>{offers?.items.slice(0,8).map(trip=><li className="offer-card" key={trip.id}><VehicleSummary trip={trip}/><div className="home-offer-info"><h3>{pointName(trip,trip.route[0])}<span aria-hidden="true"> → </span>{pointName(trip,trip.route.at(-1))}</h3><div><span>{trip.itinerary.length} paradas</span><strong>{pesos.format(trip.maximumCop)}</strong></div><button type="button" className="glass-button" onClick={()=>onNavigate('rutas',{trip,mode:'list'})}>Ver este recorrido <span aria-hidden="true">↗</span></button></div></li>)}</ul>
    </section>}
    <section id="como-funciona" className="how-section" aria-labelledby="how-heading"><div className="how-intro"><span className="card-eyebrow">Así de claro</span><h2 id="how-heading">La ruta la publica<br/>quien conduce.</h2><p>Primero conoces el recorrido. Después eliges el asiento.</p><button type="button" className="glass-button" onClick={explore}>Explorar disponibilidad <span aria-hidden="true">↗</span></button></div><ol className="how-steps"><li><span>01</span><div><h3>Mira las rutas disponibles</h3><p>Cada oferta tiene conductor, vehículo, placa, horario y un recorrido definido.</p></div></li><li><span>02</span><div><h3>Elige tus paradas</h3><p>Selecciona dónde subir y bajar entre los puntos publicados por el conductor, en el orden de su ruta.</p></div></li><li><span>03</span><div><h3>Reserva y sigue tu viaje</h3><p>Consulta la confirmación en Reservas. Cuando termine, encontrarás el recorrido en tu historial.</p></div></li></ol></section>
    <section className="community-invitation"><div><span className="card-eyebrow">Nos mueve la comunidad</span><h2>Compartir el camino<br/>empieza por conocernos.</h2></div><button type="button" className="glass-button" onClick={()=>onNavigate('nosotros')}>Conoce al equipo <span aria-hidden="true">↗</span></button></section>
  </section>
}

export function Ayuda({ onNavigate, role }) {
  if(role==='conductor' || role==='movilidad')return <AyudaGestion onNavigate={onNavigate} role={role}/>
  return <section className="help-page"><PageHeading eyebrow="Antes, durante y después" title="Estamos en el mismo camino.">Consulta cómo funcionan las rutas, las reservas y el seguimiento de tus viajes.</PageHeading><div className="help-grid">{[
    ['¿Puedo cambiar el recorrido del conductor?','Cada conductor publica una ruta específica. Puedes reservar entre sus paradas disponibles; tu reserva no cambia el recorrido ni añade un destino.'],
    ['¿Qué significa reserva pendiente?','El conductor debe revisar tu reserva. Consulta su respuesta en la sección Reservas; una solicitud pendiente todavía no ocupa un asiento confirmado.'],
    ['¿Dónde veo las diez paradas?','Abre Ver paradas en una oferta. Encontrarás el mapa, la lista ordenada y los horarios estimados del recorrido.'],
    ['¿Dónde quedan mis viajes anteriores?','Los viajes finalizados y cancelados se conservan en Historial. También puedes consultar el valor reservado y el valor final, cuando corresponda.'],
    ['¿Quién define cada recorrido?','Cada conductor define sus paradas, el horario y los cupos que ofrece. Como pasajero puedes elegir entre esas paradas, sin modificar el recorrido.'],
    ['¿Cómo reporto una situación?','En Soporte puedes abrir Mis incidentes y registrar una situación relacionada con un viaje en el que participas. Movilidad revisa los reportes de forma privada.'],
  ].map(([question,answer])=><details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div><button type="button" onClick={()=>onNavigate('incidentes')}>Abrir mis incidentes <span aria-hidden="true">↗</span></button></section>
}


function AyudaGestion({onNavigate,role}) {
  const admin=role==='movilidad'
  const questions=admin?[
    ['¿Quién puede aprobar miembros?','Movilidad valida las solicitudes de vinculación institucional desde su propia administración.'],
    ['¿Cómo se habilita un conductor?','En Conductores puedes registrar la vigencia de su licencia. Una cuenta habilitada como conductor administra ofertas y solicitudes recibidas.'],
    ['¿Qué ocurre si vence una licencia?','El conductor conserva su rol y su historial. Necesita que Movilidad actualice la licencia para publicar o modificar recorridos.'],
    ['¿Cómo se actualizan las tarifas?','En Tarifas se guarda una nueva versión. Las ofertas y reservas existentes conservan la versión con la que fueron registradas.'],
    ['¿Cómo se atiende un incidente?','Abre la bandeja de incidentes, revisa el reporte y registra su decisión y resolución.'],
    ['¿Puedo reservar asientos desde Movilidad?','La cuenta de Movilidad administra la plataforma. Las reservas de asientos corresponden al rol Pasajero.'],
  ]:[
    ['¿Dónde publico una carrera?','En Conducir → Publicar recorrido elige un vehículo propio, define de dos a diez paradas, revisa la ruta y sus horarios y publica los cupos.'],
    ['¿Dónde reviso a mis pasajeros?','En Solicitudes verás únicamente las solicitudes recibidas para tus ofertas. Puedes confirmar o rechazar las pendientes.'],
    ['¿Cómo inicio y termino una carrera?','En Mis ofertas abre tu carrera, inicia el viaje, registra la asistencia y finaliza su liquidación. El resultado queda en Historial de carreras.'],
    ['¿Dónde veo las carreras que conduje?','En Historial consulta tus carreras finalizadas y canceladas, sus recorridos y los valores liquidados.'],
    ['¿Cómo actualizo el vehículo?','En Vehículos puedes registrar y actualizar los datos, la placa y la fotografía de tus propios carros.'],
    ['¿Qué hago si mi licencia venció?','Solicita la actualización a Movilidad. Conservas tu rol de conductor, pero necesitas una licencia vigente para publicar o modificar ofertas.'],
  ]
  return <section className="help-page"><PageHeading eyebrow={admin?'Guía de administración':'Guía del conductor'} title={admin?'Coordina cada proceso.':'Todo listo para tu próxima carrera.'}>{admin?'Vinculaciones, conductores, tarifas y seguimiento.':'Publica tus ofertas, gestiona las solicitudes recibidas y conserva el registro de tus carreras.'}</PageHeading><div className="help-grid">{questions.map(([question,answer])=><details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div><button type="button" onClick={()=>onNavigate('incidentes')}>{admin?'Abrir bandeja de incidentes':'Reportar una situación de mi carrera'} <span aria-hidden="true">↗</span></button></section>
}
