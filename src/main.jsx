import { roleView, sessionRole } from '../shared/roles.js'
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Inicio, { Ayuda } from './Inicio.jsx'
import Historial from './Historial.jsx'
import Nosotros from './Nosotros.jsx'
import Movilidad from './Movilidad.jsx'
import Incidentes from './Incidentes.jsx'
import Vehiculos from './Vehiculos.jsx'
import BuscarViajes from './BuscarViajes.jsx'
import Reservas from './Reservas.jsx'
import { AvisosViajes, api } from './Itinerario.jsx'
import { EnlacesCuenta, Perfil } from './Cuenta.jsx'
import { retireOfflineShell } from './web.js'
import './styles.css'

function readAccountLink() {
  const params=new URLSearchParams(window.location.hash.slice(1))
  const action=params.get('action'),token=params.get('token')
  return token && ['recover','verify'].includes(action) ? {action,token} : null
}

const entry=(id,label,description,options={})=>({id,label,description,options})
function navigationFor(session) {
  const account={id:'cuenta',label:'Cuenta',intro:'Tu espacio, a tu manera.',items:session?[
    entry('perfil','Mi perfil','Nombre visible y preferencias'),
    entry('seguridad','Acceso y seguridad','Correo institucional y contraseña'),
    entry('salir','Cerrar sesión','Termina el acceso en este navegador'),
  ]:[
    entry('login','Iniciar sesión','Entra con tu cuenta institucional'),
    entry('register','Crear cuenta','Únete a la comunidad universitaria'),
    entry('recover','Recuperar acceso','Solicita un enlace para tu correo'),
  ]}
  const community={id:'comunidad',label:'Comunidad',intro:'Compartimos más que un destino.',items:[
    entry('nosotros','Quiénes somos','Nuestra manera de compartir el camino'),
    entry('nosotros','Nuestro equipo','Conoce a los seis integrantes',{anchor:'equipo'}),
    entry('nosotros','Créditos fotográficos','Fuentes y licencias de las imágenes',{anchor:'creditos'}),
  ]}
  if(session?.mobility)return [
    {id:'inicio',label:'Inicio',intro:'Una comunidad en movimiento.',items:[entry('inicio','Vista general','Inicio de tu espacio de administración'),entry('ayuda','Guía de uso','Cómo se organiza la plataforma')]},
    {id:'vinculaciones',label:'Vinculaciones',intro:'Primero, una comunidad verificada.',items:[entry('movilidad','Solicitudes pendientes','Revisa las vinculaciones institucionales',{tab:'solicitudes'}),entry('ayuda','Guía de vinculación','Consulta el proceso de acceso')]},
    {id:'conductores',label:'Conductores',intro:'Personas habilitadas para compartir.',items:[entry('movilidad','Habilitar conductores','Permisos y vigencia de licencias',{tab:'conductores'}),entry('ayuda','Publicación de rutas','Cómo se define un recorrido')]},
    {id:'tarifas',label:'Tarifas',intro:'Valores claros antes de salir.',items:[entry('movilidad','Administrar tarifas','Configura y conserva sus versiones',{tab:'tarifas'}),entry('ayuda','Reservas y valores','Consulta cómo se conserva una reserva')]},
    {id:'soporte',label:'Incidentes',intro:'Atención y seguimiento.',items:[entry('incidentes','Bandeja de incidentes','Reportes y decisiones de Movilidad'),entry('ayuda','Ayuda','Preguntas frecuentes')]},
    community,account,
  ]
  if(session?.driver)return [
    {id:'inicio',label:'Inicio',intro:'Tu espacio como conductor.',items:[entry('inicio','Mi panel de conductor','Tus ofertas y solicitudes recibidas'),entry('publicados','Publicar recorrido','Ofrece un asiento en tu vehículo',{compose:true})]},
    {id:'conducir',label:'Conducir',intro:'Tu ruta. Tus horarios. Tus ofertas.',items:[entry('publicados','Mis ofertas','Administra tus recorridos publicados',{tripStatus:'active'}),entry('publicados','Publicar recorrido','Define tus paradas y cupos',{compose:true}),entry('publicados','Carrera en curso','Continúa y registra el cierre de tu viaje',{tripStatus:'EnCurso'})]},
    {id:'solicitudes',label:'Solicitudes',intro:'Pasajeros para tus propios recorridos.',items:[entry('solicitudes','Todas las solicitudes','Recibidas para las ofertas que tú publicaste',{filter:'todas'}),entry('solicitudes','Por responder','Confirma o rechaza las solicitudes pendientes',{filter:'Pendiente'}),entry('solicitudes','Pasajeros confirmados','Asientos que aceptaste en tus carreras',{filter:'Confirmada'}),entry('solicitudes','Rechazadas y cerradas','Consulta las decisiones anteriores',{filter:'cerradas'})]},
    {id:'historial',label:'Historial',intro:'El registro de tus carreras.',items:[entry('historial','Todas mis carreras','Únicamente los recorridos que ofreciste',{filter:''}),entry('historial','Carreras finalizadas','Consulta el resultado y el total liquidado',{filter:'Completado'}),entry('historial','Carreras canceladas','Tu registro de cancelaciones',{filter:'Cancelado'})]},
    {id:'vehiculos',label:'Vehículos',intro:'Tus carros, listos para compartir.',items:[entry('vehiculos','Mis vehículos','Fotos, placas y características de tus carros'),entry('vehiculos','Registrar o actualizar vehículo','Mantén al día los datos de tus propios vehículos')]},
    community,
    {id:'soporte',label:'Soporte',intro:'Te acompañamos en tus carreras.',items:[entry('ayuda','Guía del conductor','Publicación, pasajeros y cierre del recorrido'),entry('incidentes','Incidentes de mis carreras','Reporta y consulta situaciones de tus viajes')]},
    account,
  ]
  return [
    {id:'inicio',label:'Inicio',intro:'Cada recorrido empieza por conocernos.',items:[entry('inicio','Nuestra propuesta','Un lugar para compartir el camino'),entry('inicio','Cómo funciona','Conoce el proceso antes de reservar',{anchor:'como-funciona'}),entry('rutas','Próximas salidas','Consulta las ofertas de mañana')]},
    {id:'rutas',label:'Rutas',intro:'El recorrido ya está definido.',items:[entry('rutas','Rutas disponibles','Conductores, vehículos, horarios y cupos',{mode:'list'}),entry('rutas','Mapa de recorridos','Explora las ofertas publicadas en Cali',{mode:'map'}),entry('rutas','Paradas publicadas','Puntos por los que pasan los conductores',{mode:'stops'})]},
    {id:'reservas',label:'Reservas',intro:'Tu asiento, en un mismo lugar.',items:[entry('reservas','Todas mis reservas','Consulta tus solicitudes y respuestas',{filter:'todas'}),entry('reservas','Pendientes','A la espera de respuesta',{filter:'Pendiente'}),entry('reservas','Confirmadas','Asientos aceptados por el conductor',{filter:'Confirmada'}),entry('reservas','Canceladas y vencidas','Consulta los estados anteriores',{filter:'cerradas'})]},
    {id:'historial',label:'Historial',intro:'Cada camino deja su historia.',items:[entry('historial','Todos mis viajes','Consulta tus recorridos anteriores',{filter:''}),entry('historial','Finalizados','Viajes completados y valores finales',{filter:'Completado'}),entry('historial','Cancelados','Recorridos y reservas cancelados',{filter:'Cancelado'})]},

    community,
    {id:'soporte',label:'Soporte',intro:'Antes, durante y después del viaje.',items:[entry('ayuda','Guía de uso','Respuestas claras para cada paso'),entry('incidentes','Mis incidentes','Reporta una situación de un viaje')]},
    account,
  ]
}

function SiteNavigation({session,active,onNavigate,onAccess,menu,setMenu}) {
  const host=useRef(null),trigger=useRef(null)
  const groups=navigationFor(session),open=groups.find(group=>group.id===menu)
  useEffect(()=>{
    const outside=event=>{if(!host.current?.contains(event.target))setMenu(null)}
    const escape=event=>{if(event.key==='Escape'){setMenu(null);trigger.current?.focus()}}
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}
  },[])
  function choose(item) {
    setMenu(null)
    if(['login','register','recover'].includes(item.id))onAccess(item.id)
    else onNavigate(item.id,item.options)
  }
  return <header className={'site-header'+(menu?' menu-is-open':'')} ref={host}>
    <div className="header-inner"><button type="button" className="brand-logo-button" aria-label="Ir al inicio" onClick={()=>{setMenu(null);onNavigate('inicio')}}><img src="/jalon-logo.webp" alt="" width="92" height="92"/></button>
      <nav className="primary-nav" aria-label="Navegación principal">{groups.map(group=><button type="button" key={group.id} className="primary-nav-link" aria-expanded={menu===group.id} aria-controls="navigation-mega" aria-current={group.items.some(item=>item.id===active)?'page':undefined} onClick={event=>{trigger.current=event.currentTarget;setMenu(current=>current===group.id?null:group.id)}} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();trigger.current=event.currentTarget;setMenu(group.id);setTimeout(()=>document.querySelector('#navigation-mega button')?.focus(),30)}}}>{group.label}<svg viewBox="0 0 12 12" aria-hidden="true" width="10" height="10"><path d="m2 4 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg></button>)}</nav>
      {!session && <button type="button" className="header-access" onClick={()=>onAccess('login')}>Entrar</button>}
      {session && <span className="session-indicator" title={session.mobility?'Administración':session.driver?'Conductor':'Pasajero'}><span className="status-dot"/><span>{session.mobility?'Movilidad':session.driver?'Conductor':'Pasajero'}</span></span>}
    </div>
    {open && <div id="navigation-mega" className="navigation-mega"><div className="mega-feature"><span className="card-eyebrow">{open.label}</span><h2>{open.intro}</h2>{open.id==='cuenta' && session && <p className="account-email">{session.email}</p>}<span className="mega-decoration" aria-hidden="true">↗</span></div><div className="mega-items">{open.items.map((item,index)=><button type="button" key={item.id+index} onClick={()=>choose(item)}><span className="menu-icon" aria-hidden="true">{String(index+1).padStart(2,'0')}</span><span><strong>{item.label}</strong><small>{item.description}</small></span><span className="menu-arrow" aria-hidden="true">↗</span></button>)}</div><button type="button" className="round-button menu-close" aria-label="Cerrar menú" onClick={()=>{setMenu(null);trigger.current?.focus()}}>×</button></div>}
  </header>
}

function SiteFooter({onNavigate,session}) {
  const role=sessionRole(session)
  const first=role==='movilidad'?['Administración',[['Vinculaciones','movilidad',{tab:'solicitudes'}],['Conductores','movilidad',{tab:'conductores'}],['Tarifas','movilidad',{tab:'tarifas'}]]]
    :role==='conductor'?['Tus carreras',[['Mis ofertas','publicados',{}],['Solicitudes recibidas','solicitudes',{}],['Historial de carreras','historial',{}],['Mis vehículos','vehiculos',{}]]]
    :['Tu recorrido',[['Rutas disponibles','rutas',{}],['Mis reservas','reservas',{}],['Historial de viajes','historial',{}]]]
  return <footer className="site-footer"><div className="footer-mark"><img src="/jalon-logo.webp" alt="" width="112" height="112"/><p>Compartir el camino<br/><strong>nos acerca.</strong></p></div><div className="footer-links"><div><h3>{first[0]}</h3>{first[1].map(([label,id,options])=><button key={label} onClick={()=>onNavigate(id,options)}>{label}</button>)}</div><div><h3>Comunidad</h3><button onClick={()=>onNavigate('nosotros')}>Quiénes somos</button><button onClick={()=>onNavigate('nosotros',{anchor:'equipo'})}>Nuestro equipo</button><button onClick={()=>onNavigate('nosotros',{anchor:'creditos'})}>Créditos de imágenes</button></div><div><h3>Te acompañamos</h3><button onClick={()=>onNavigate('ayuda')}>{role==='conductor'?'Guía del conductor':'Guía de uso'}</button><button onClick={()=>onNavigate('incidentes')}>{role==='conductor'?'Incidentes de mis carreras':'Mis incidentes'}</button><button onClick={()=>onNavigate('perfil')}>Mi perfil</button></div></div><div className="footer-bottom"><span>Proyecto académico · Universidad Santiago de Cali</span><span>Una comunidad. Muchos caminos.</span></div></footer>
}

function AuthDialog({mode,setMode,busy,message,onSubmit,onClose,accountLink}) {
  const ref=useRef(null),heading=mode==='register'?'Tu próximo camino empieza aquí.':mode==='recover'?'Recupera tu acceso.':'Qué bueno verte de nuevo.'
  useEffect(()=>{const element=ref.current;element.showModal();return()=>element.close()},[])
  return <dialog className="auth-dialog" ref={ref} aria-labelledby="auth-heading" onCancel={event=>{event.preventDefault();if(!busy)onClose()}} onClick={event=>{if(event.target===ref.current&&!busy)onClose()}}>
    <div className="auth-illustration"><img src="/jalon-logo.webp" width="500" height="500" alt="Un camino compartido en la comunidad"/><div><span className="card-eyebrow">Nos mueve compartir</span><h2>El camino se disfruta<br/>mejor en compañía.</h2><p>Recorridos definidos, conductores de tu comunidad y un asiento para ti.</p></div></div>
    <div className="auth-content"><button type="button" className="round-button auth-close" aria-label="Cerrar acceso" disabled={busy} onClick={onClose}>×</button><span className="card-eyebrow">Tu cuenta institucional</span><h2 id="auth-heading">{heading}</h2>
      {mode==='recover'?<EnlacesCuenta link={accountLink}/>:<><div className="auth-mode-switch" aria-label="Opciones de acceso"><button type="button" aria-pressed={mode==='login'} onClick={()=>setMode('login')}>Iniciar sesión</button><button type="button" aria-pressed={mode==='register'} onClick={()=>setMode('register')}>Crear cuenta</button></div>
      <form onSubmit={onSubmit} aria-busy={busy} key={mode}><label htmlFor="email">Correo institucional<input id="email" name="email" type="email" autoComplete="email" placeholder="nombre@usc.edu.co" maxLength={254} required/></label><label htmlFor="password">Contraseña<input id="password" name="password" type="password" autoComplete={mode==='login'?'current-password':'new-password'} aria-describedby="password-help" minLength={10} maxLength={128} required/></label><small id="password-help">{mode==='register'?'Entre 10 y 128 caracteres.':'Usa la contraseña de tu cuenta.'}</small><button type="submit" className="primary" disabled={busy}>{busy?'Procesando…':mode==='login'?'Entrar':'Crear mi cuenta'} <span aria-hidden="true">↗</span></button></form><button type="button" className="text-button recovery-link" onClick={()=>setMode('recover')}>¿Necesitas recuperar el acceso?</button></>}
      {message && <p className={message.error?'notice error':'notice'} role={message.error?'alert':'status'}>{message.text}</p>}
      {mode==='recover' && <button className="text-button" type="button" onClick={()=>setMode('login')}>Volver al inicio de sesión</button>}
    </div>
  </dialog>
}

function Access() {
  const [session,setSession]=useState(null),[busy,setBusy]=useState(true),[message,setMessage]=useState(null)
  const [active,setActive]=useState('inicio'),[options,setOptions]=useState({}),[menu,setMenu]=useState(null)
  const [auth,setAuth]=useState(null),[accountLink,setAccountLink]=useState(readAccountLink)
  const [catalogue,setCatalogue]=useState({mode:'list',trip:null}),[navigationId,setNavigationId]=useState(0),[composeSignal,setComposeSignal]=useState(0)
  const pending=useRef(null)
  useEffect(()=>{
    const controller=new AbortController()
    api('/api/session',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setSession(value)}).catch(()=>{}).finally(()=>{if(!controller.signal.aborted)setBusy(false)})
    return()=>controller.abort()
  },[])
  useEffect(()=>{
    if(accountLink)setAuth('recover')
    const change=()=>{const link=readAccountLink();if(link){setAccountLink(link);setAuth('recover')}}
    window.addEventListener('hashchange',change)
    return()=>window.removeEventListener('hashchange',change)
  },[accountLink?.token])
  function openAccess(mode='login') {setMenu(null);setMessage(null);setAuth(mode)}
  function navigate(id,next={}) {
    setMenu(null)
    if(id==='salir'){signOut();return}
    if(!session && !['inicio','nosotros','ayuda'].includes(id)){pending.current={id,next};openAccess();return}
    id=roleView(session,id)
    setActive(id);setOptions(next);setNavigationId(value=>value+1)
    if(id==='rutas')setCatalogue({mode:next.mode||'list',trip:next.trip||null})
    if(next.compose)setComposeSignal(value=>value+1)
    setTimeout(()=>{if(next.anchor){const el=document.getElementById(next.anchor);if(el?.tagName==='DETAILS')el.open=true;el?.scrollIntoView({behavior:'smooth',block:'start'})}else window.scrollTo({top:0,behavior:'smooth'})},35)
  }
  async function submit(event) {
    event.preventDefault();setBusy(true);setMessage(null)
    const fields=Object.fromEntries(new FormData(event.currentTarget))
    try {
      const result=await api(auth==='register'?'/api/register':'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields)})
      if(auth==='register'){setMessage({text:'Tu cuenta quedó pendiente de revisión por Movilidad.'})}
      else {
        setSession(result);setAuth(null);setActive(roleView(result,pending.current?.id||'inicio'));setOptions(pending.current?.next||{})
        if(!result.driver && !result.mobility && pending.current?.id==='rutas')setCatalogue({mode:pending.current.next?.mode||'list',trip:null})
        pending.current=null
      }
    }catch(error){setMessage({error:true,text:error.message})}finally{setBusy(false)}
  }
  async function signOut() {
    setBusy(true);setMessage(null)
    try{await api('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});setSession(null);setActive('inicio');setMenu(null);setMessage({text:'Sesión cerrada.'})}
    catch(error){setMessage({error:true,text:error.message})}finally{setBusy(false)}
  }
  return <div className="site-shell">
    <SiteNavigation session={session} active={active} onNavigate={navigate} onAccess={openAccess} menu={menu} setMenu={setMenu}/>
    {menu && <button type="button" className="menu-backdrop" aria-label="Cerrar menú desplegado" onClick={()=>setMenu(null)}/>}
    <main className="workspace-content" id="main-content">
      {message && !auth && <p className={message.error?'notice error global-notice':'notice global-notice'} role={message.error?'alert':'status'}>{message.text}</p>}
      {session && !session.mobility && <AvisosViajes/>}
      <div className="workspace-panel" hidden={active!=='inicio'}><Inicio session={session} onNavigate={navigate} onAccess={openAccess}/></div>
      {session && !session.mobility && !session.driver && <>
        <div className="workspace-panel" hidden={active!=='rutas'}><BuscarViajes initialView={catalogue.mode} initialTrip={catalogue.trip}/></div>
        <div className="workspace-panel" hidden={active!=='reservas'}><Reservas role="pasajero" initialFilter={options.filter} navigationId={navigationId}/></div>
        <div className="workspace-panel" hidden={active!=='historial'}>{active==='historial' && <Historial role="pasajero" initialFilter={options.filter||''} navigationId={navigationId}/>}</div>
      </>}
      {session?.driver && !session.mobility && <>
        <div className="workspace-panel" hidden={active!=='solicitudes'}><Reservas role="conductor" initialFilter={options.filter} navigationId={navigationId}/></div>
        <div className="workspace-panel" hidden={active!=='historial'}>{active==='historial' && <Historial role="conductor" initialFilter={options.filter||''} navigationId={navigationId}/>}</div>
        <div className="workspace-panel conductor-panel" hidden={!['publicados','vehiculos'].includes(active)}><Vehiculos view={active} composeSignal={composeSignal} tripStatus={options.tripStatus} navigationId={navigationId} composeRequested={Boolean(options.compose)}/></div>
      </>}
      {session?.mobility && <div className="workspace-panel" hidden={active!=='movilidad'}><Movilidad initialTab={options.tab} navigationId={navigationId}/></div>}
      <div className="workspace-panel" hidden={active!=='nosotros'}>{active==='nosotros' && <Nosotros/>}</div>
      <div className="workspace-panel" hidden={active!=='ayuda'}>{active==='ayuda' && <Ayuda onNavigate={navigate} role={sessionRole(session)}/>}</div>
      {session && <>
        <div className="workspace-panel" hidden={active!=='incidentes'}>{active==='incidentes' && <Incidentes mobility={Boolean(session.mobility)}/>}</div>
        <div className="workspace-panel profile-page" hidden={active!=='perfil'}>{active==='perfil' && <Perfil/>}</div>
        <div className="workspace-panel security-page" hidden={active!=='seguridad'}>{active==='seguridad' && <EnlacesCuenta/>}</div>
      </>}
    </main>
    <SiteFooter onNavigate={navigate} session={session}/>
    {auth && <AuthDialog mode={auth} setMode={mode=>{setAuth(mode);setMessage(null)}} busy={busy} message={message} onSubmit={submit} accountLink={accountLink} onClose={()=>{setAuth(null);setAccountLink(null)}}/>}
  </div>
}
retireOfflineShell().catch(()=>{})
createRoot(document.getElementById('root')).render(<Access/>)
