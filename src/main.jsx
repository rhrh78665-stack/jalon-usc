import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Movilidad from './Movilidad.jsx'
import Vehiculos from './Vehiculos.jsx'
import BuscarViajes from './BuscarViajes.jsx'
import Reservas from './Reservas.jsx'
import { AvisosViajes } from './Itinerario.jsx'
import { EnlacesCuenta, Perfil } from './Cuenta.jsx'
import './styles.css'

function readAccountLink() {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const action = params.get('action')
  const token = params.get('token')
  return token && ['recover', 'verify'].includes(action) ? { action, token } : null
}

function Marca() {
  return (
    <div className="workspace-brand">
      <img src="/jalon-logo.webp" width="48" height="48" alt="" />
      <strong>Jalón USC</strong>
    </div>
  )
}

function Panel({ session, busy, signOut }) {
  const [active, setActive] = useState(session.mobility ? 'movilidad' : 'viajes')
  const sections = session.mobility
    ? [['movilidad', 'Movilidad'], ['perfil', 'Perfil']]
    : [['viajes', 'Buscar viajes'], ['reservas', 'Reservas'],
       ['publicados', 'Mis viajes'], ['vehiculos', 'Vehículos'], ['perfil', 'Perfil']]
  return (
    <div className="workspace">
      <header className="workspace-header">
        <Marca />
        <div className="account">
          <span>{session.email}</span>
          <button type="button" disabled={busy} onClick={signOut}>{busy ? 'Cerrando…' : 'Cerrar sesión'}</button>
        </div>
      </header>
        <nav className="workspace-tabs" aria-label="Secciones de Jalón USC">
          {sections.map(([id, label]) => (
            <button key={id} type="button" aria-current={active === id ? 'page' : undefined}
              aria-controls={id === 'publicados' || id === 'vehiculos' ? 'panel-conductor' : 'panel-' + id}
              onClick={() => setActive(id)}>
              {label}
            </button>
          ))}
        </nav>
      <div className="workspace-content">
        {!session.mobility && <AvisosViajes />}
        {session.mobility && <div id="panel-movilidad" className="workspace-panel" hidden={active !== 'movilidad'}><Movilidad /></div>}
        {!session.mobility && (
          <>
            <div id="panel-viajes" className="workspace-panel" hidden={active !== 'viajes'}><BuscarViajes /></div>
            <div id="panel-reservas" className="workspace-panel" hidden={active !== 'reservas'}><Reservas /></div>
            <div id="panel-conductor" className="workspace-panel" hidden={!['publicados', 'vehiculos'].includes(active)}>
              <Vehiculos view={active} />
            </div>
          </>
        )}
        <div id="panel-perfil" className="workspace-panel" hidden={active !== 'perfil'}><Perfil /></div>
      </div>
    </div>
  )
}

function Access() {
  const [accountLink, setAccountLink] = useState(readAccountLink)
    const [login, setLogin] = useState(false)
    const [busy, setBusy] = useState(true)
    const [message, setMessage] = useState(null)
    const [session, setSession] = useState(null)

  useEffect(() => {
    function updateAccountLink() {
      const link = readAccountLink()
      if (link) setAccountLink(link)
    }

    window.addEventListener('hashchange', updateAccountLink)
    return () => window.removeEventListener('hashchange', updateAccountLink)
  }, [])

    useEffect(() => {
        const controller = new AbortController()

        async function restoreSession() {
            try {
                const response = await fetch('/api/session', { signal: controller.signal })
                if (response.ok) {
                    const active = await response.json()
                    setSession(current => current ?? active)
                }
            } catch {
                return
            } finally {
                if (!controller.signal.aborted) setBusy(false)
            }
        }

        restoreSession()
        return () => controller.abort()
    }, [])

    async function submit(event) {
        event.preventDefault()
        const form = event.currentTarget
        const fields = Object.fromEntries(new FormData(form))
        setMessage(null)
        setBusy(true)

        try {
            const response = await fetch(login ? '/api/login' : '/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fields),
            })
            const result = await response.json()

            if (!response.ok) {
                setMessage({ error: true, text: result.message })
                return
            }

            form.reset()
            if (login) {
                setSession(result)
            } else {
                setMessage({ text: 'Tu cuenta quedó pendiente de revisión por Movilidad.' })
            }
        } catch {
            setMessage({ error: true, text: 'No se pudo enviar la solicitud. Inténtalo de nuevo.' })
        } finally {
            setBusy(false)
        }
    }

    async function signOut() {
        setBusy(true)
        setMessage(null)

        try {
            const response = await fetch('/api/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            })

            if (!response.ok) {
                setMessage({ error: true, text: 'No se pudo cerrar la sesión. Inténtalo de nuevo.' })
                return
            }

            setSession(null)
            setLogin(true)
            setMessage({ text: 'Sesión cerrada.' })
        } catch {
            setMessage({ error: true, text: 'No se pudo conectar para cerrar la sesión.' })
        } finally {
            setBusy(false)
        }
    }

    return (
        <main className={session ? 'app-shell' : 'auth-shell'}>
            {session ? (
                <Panel session={session} busy={busy} signOut={signOut} />
            ) : (
                <>
                    <Marca />
                    <h1>{login ? 'Iniciar sesión' : 'Crea tu cuenta'}</h1>
                    <form onSubmit={submit} aria-busy={busy} key={login ? 'login' : 'register'}>
                        <label htmlFor="email">Correo institucional</label>
                        <input id="email" name="email" type="email" autoComplete="email"
                            placeholder="nombre@usc.edu.co" maxLength={254} required />
                        <label htmlFor="password">Contraseña</label>
                        <input id="password" name="password" type="password"
                            autoComplete={login ? 'current-password' : 'new-password'}
                            aria-describedby="password-help" minLength={10} maxLength={128} required />
                        <small id="password-help">Entre 10 y 128 caracteres.</small>
                        <button disabled={busy}>
                            {busy ? 'Procesando…' : login ? 'Entrar' : 'Crear cuenta'}
                        </button>
                    </form>
                    <button type="button" disabled={busy} onClick={() => {
                        setLogin(current => !current)
                        setMessage(null)
                    }}>
                        {login ? 'Crear una cuenta' : 'Ya tengo cuenta'}
                    </button>
                </>
            )}

      {(accountLink || (!session && !busy)) && (
        <EnlacesCuenta key={accountLink?.token ?? 'request'} link={accountLink} />
      )}

            {message && (
                <p className={message.error ? 'notice error' : 'notice'}
                    role={message.error ? 'alert' : 'status'}>{message.text}</p>
            )}
        </main>
    )
}

createRoot(document.getElementById('root')).render(<Access />)
