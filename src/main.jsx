import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Movilidad from './Movilidad.jsx'
import Vehiculos from './Vehiculos.jsx'
import BuscarViajes from './BuscarViajes.jsx'
import { AvisosViajes } from './Itinerario.jsx'
import { EnlacesCuenta, Perfil } from './Cuenta.jsx'
import './styles.css'

function readAccountLink() {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const action = params.get('action')
  const token = params.get('token')
  return token && ['recover', 'verify'].includes(action) ? { action, token } : null
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
        <main>
            <p className="brand">Jalón USC</p>
            {session ? (
                <>
                    <h1>Sesión iniciada</h1>
                    <p>{session.email}</p>
                    <button type="button" disabled={busy} onClick={signOut}>
                        {busy ? 'Cerrando…' : 'Cerrar sesión'}
                    </button>
          <Perfil />
                    {session.mobility ? <Movilidad /> : <><AvisosViajes /><BuscarViajes /><Vehiculos /></>}
                </>
            ) : (
                <>
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
