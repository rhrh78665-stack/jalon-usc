import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

function Access() {
    const [login, setLogin] = useState(false)
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState(null)
    const [session, setSession] = useState(null)

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
                // El formulario sigue disponible si la consulta inicial falla.
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

    return (
        <main>
            <p className="brand">Jalón USC</p>
            {session ? (
                <>
                    <h1>Sesión iniciada</h1>
                    <p>{session.email}</p>
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

                    {message && (
                        <p className={message.error ? 'notice error' : 'notice'}
                            role={message.error ? 'alert' : 'status'}>{message.text}</p>
                    )}

                    <button type="button" disabled={busy} onClick={() => {
                        setLogin(current => !current)
                        setMessage(null)
                    }}>
                        {login ? 'Crear una cuenta' : 'Ya tengo cuenta'}
                    </button>
                </>
            )}
        </main>
    )
}

createRoot(document.getElementById('root')).render(<Access />)