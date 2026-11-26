import React, { useEffect, useState } from 'react'
import { api, horaLocal } from './Itinerario.jsx'
import { pointName } from '../shared/route-points.js'

export default function InicioGestion({session,onNavigate}) {
  const admin=Boolean(session.mobility)
  const [data,setData]=useState(null),[error,setError]=useState('')
  const [revision,setRevision]=useState(0)
  useEffect(()=>{
    const controller=new AbortController()
    setError('')
    const paths=admin?['/api/movilidad/solicitudes','/api/movilidad/conductores','/api/incidents']:['/api/trips/mine','/api/reservations']
    Promise.all(paths.map(path=>api(path,{signal:controller.signal}))).then(values=>{if(!controller.signal.aborted)setData(values)})
      .catch(failure=>{if(!controller.signal.aborted)setError(failure.message)})
    const refresh=()=>setRevision(value=>value+1)
    window.addEventListener('jalon-trips-update',refresh);window.addEventListener('jalon-reservas-update',refresh)
    return()=>{controller.abort();window.removeEventListener('jalon-trips-update',refresh);window.removeEventListener('jalon-reservas-update',refresh)}
  },[session.email,admin,revision])
  const trips=admin?[]:data?.[0]||[],requests=admin?[]:data?.[1]||[]
  const active=trips.filter(trip=>['Programado','Lleno','EnCurso'].includes(trip.status))
  const next=active.slice().sort((a,b)=>a.departAt.localeCompare(b.departAt)).slice(0,4)
  const pending=requests.filter(request=>request.status==='Pendiente')
  const stats=admin?[
    ['Vinculaciones pendientes',data?.[0]?.length,'movilidad',{tab:'solicitudes'}],
    ['Conductores habilitados',data?.[1]?.filter(driver=>driver.enabled).length,'movilidad',{tab:'conductores'}],
    ['Incidentes por revisar',data?.[2]?.filter(incident=>incident.status==='Recibido').length,'incidentes',{}],
  ]:[
    ['Ofertas activas',data?active.length:null,'publicados',{}],
    ['Solicitudes pendientes',data?pending.length:null,'solicitudes',{filter:'Pendiente'}],
    ['Carreras finalizadas',data?trips.filter(trip=>trip.status==='Completado').length:null,'historial',{filter:'Completado'}],
  ]
  return <section className="home-page management-home" aria-labelledby="management-heading">
    <div className="landing-hero">
      <div className="landing-copy"><span className="card-eyebrow">{admin?'Coordinación de Movilidad':'Tu espacio como conductor'}</span>
        <h1 id="management-heading">{admin?<>Una comunidad.<br/>Muchos caminos.<br/><em>Todo conectado.</em></>:<>Tu ruta.<br/>Tus horarios.<br/><em>Tu próxima carrera.</em></>}</h1>
        <p>{admin?'Administra las vinculaciones, la habilitación de conductores, las tarifas y los incidentes.':'Publica tus recorridos, revisa las solicitudes de tus pasajeros y lleva el control de las carreras que ofreces.'}</p>
        <div className="hero-actions"><button type="button" className="primary" onClick={()=>onNavigate(admin?'movilidad':'publicados',admin?{tab:'solicitudes'}:{compose:true})}>{admin?'Revisar vinculaciones':'Publicar recorrido'} <span aria-hidden="true">↗</span></button><button type="button" className="glass-button" onClick={()=>onNavigate(admin?'movilidad':'solicitudes',admin?{tab:'conductores'}:{filter:'Pendiente'})}>{admin?'Ver conductores':'Revisar solicitudes'}</button></div>
        <div className="hero-note"><span className="status-dot"/>{admin?'Validaciones · Tarifas · Seguimiento':'Mis ofertas · Solicitudes recibidas · Historial de carreras'}</div>
      </div>
      <div className="landing-art"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><img src="/jalon-logo.webp" alt="" width="720" height="720" fetchPriority="high"/><div className="floating-route"><span className="route-dot"/><div><strong>{admin?'Un espacio para coordinar':'El recorrido lo defines tú'}</strong><span>{admin?'Gestiona cada proceso de la comunidad':'Publica tus paradas y administra tus cupos'}</span></div><span aria-hidden="true">↗</span></div></div>
    </div>
    {session.driverExpired && <p className="notice driver-expired" role="status">Tu licencia requiere actualización por Movilidad. Puedes consultar tus carreras y solicitudes; para publicar o modificar ofertas necesitas una habilitación vigente.</p>}
    <div className="management-content">
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="management-stats">{stats.map(([label,count,id,options])=><button type="button" key={label} onClick={()=>onNavigate(id,options)}><span>{label}</span><strong>{count??'—'}</strong><span aria-hidden="true">↗</span></button>)}</div>
      {!admin && <section className="driver-next-section"><header className="section-heading-row"><div><span className="card-eyebrow">Tus recorridos publicados</span><h2>Tus próximas carreras.</h2><p>Gestiona las ofertas que publicaste y los pasajeros que solicitan un asiento.</p></div><button type="button" className="glass-button" onClick={()=>onNavigate('publicados')}>Ver mis ofertas <span aria-hidden="true">↗</span></button></header>
        {data && !next.length && <div className="empty-results"><h3>Tu próxima carrera empieza con una oferta.</h3><p>Publica el recorrido, las paradas, el horario y los cupos de tu vehículo.</p><button type="button" onClick={()=>onNavigate('publicados',{compose:true})}>Publicar mi primer recorrido</button></div>}
        <ul className="driver-upcoming-list">{next.map(trip=><li key={trip.id} data-owned-trip-id={trip.id}><div><span className="booking-status">{trip.status==='EnCurso'?'En curso':trip.status}</span><h3>{pointName(trip,trip.route[0])} → {pointName(trip,trip.route.at(-1))}</h3><p>{horaLocal.format(new Date(trip.departAt))} · {trip.route.length} paradas · {trip.capacity} cupos ofrecidos</p></div><button type="button" className="glass-button" onClick={()=>onNavigate('publicados')}>Gestionar carrera <span aria-hidden="true">↗</span></button></li>)}</ul>
      </section>}
      <section className="how-section management-guide"><div className="how-intro"><span className="card-eyebrow">{admin?'Tu función en la comunidad':'Así organizas cada carrera'}</span><h2>{admin?'Coordina con claridad.':'Ofrece. Confirma. Conduce.'}</h2><button type="button" className="glass-button" onClick={()=>onNavigate('ayuda')}>Consultar mi guía <span aria-hidden="true">↗</span></button></div><ol className="how-steps">{(admin?[
        ['Revisa las vinculaciones','Valida el acceso de los miembros de la comunidad.'],
        ['Administra conductores y tarifas','Habilita conductores con licencia vigente y conserva las versiones de tarifas.'],
        ['Da seguimiento','Revisa los incidentes recibidos y registra su resolución.'],
      ]:[
        ['Publica tu oferta','Elige tu vehículo, tus paradas, la hora de salida y los cupos que compartes.'],
        ['Revisa las solicitudes','Confirma o rechaza las solicitudes de los pasajeros para tus propios recorridos.'],
        ['Conduce y registra el cierre','Inicia tu carrera, marca la asistencia y finaliza el viaje. Su resultado queda en tu historial.'],
      ]).map(([title,text],index)=><li key={title}><span>{String(index+1).padStart(2,'0')}</span><div><h3>{title}</h3><p>{text}</p></div></li>)}</ol></section>
    </div>
  </section>
}
