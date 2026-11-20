import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

function Registration() {
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState(null)

    async function register(event) {
        event.preventDefault()
        const form = event.currentTarget
        const fields = Object.fromEntries(new FormData(form))

        setMessage(null)
        setBusy(true)

        try {
            const response = await fetch('/api/register', {
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
            setMessage({ text: 'Tu cuenta quedó pendiente de revisión por Movilidad.' })
        } catch {
            setMessage({
                error: true,
                text: 'No se pudo enviar el registro. Inténtalo de nuevo.',
            })
        } finally {
            setBusy(false)
        }
    }

    return (
        <main>
            <p className="brand">Jalón USC</p>
            <h1>Crea tu cuenta</h1>

            <form onSubmit={register} aria-busy={busy}>
                <label htmlFor="email">Correo institucional</label>
                <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="nombre@usc.edu.co"
                    maxLength={254}
                    required
                />

                <label htmlFor="password">Contraseña</label>
                <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    aria-describedby="password-help"
                    minLength={10}
                    maxLength={128}
                    required
                />
                <small id="password-help">Entre 10 y 128 caracteres.</small>

                <button disabled={busy}>{busy ? 'Registrando…' : 'Crear cuenta'}</button>
            </form>

            {message && (
                <p
                    className={message.error ? 'notice error' : 'notice'}
                    role={message.error ? 'alert' : 'status'}
                >
                    {message.text}
                </p>
            )}
        </main>
    )
}

createRoot(document.getElementById('root')).render(<Registration />)