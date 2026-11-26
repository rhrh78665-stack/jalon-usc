import Avisos from './Avisos.jsx'
import Reputacion from './Reputacion.jsx'
import Penalizaciones from './Penalizaciones.jsx'
import React, { useEffect, useState } from 'react'

export function EnlacesCuenta({ link }) {
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const confirming = Boolean(link)

  useEffect(() => {
    if (confirming) window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [confirming])

  async function submit(event) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const action = confirming ? link.action : data.get('action')
    const body = confirming
      ? { token: link.token, password: data.get('password') }
      : { email: data.get('email') }

    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/account/${action}/${confirming ? 'confirm' : 'request'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      setMessage({ error: !response.ok, text: result.message })
      if (response.ok && confirming) setDone(true)
    } catch {
      setMessage({ error: true, text: 'No se pudo completar la solicitud.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="account-links">
      <h2 id="account-links">Recuperar acceso o verificar correo</h2>
      {!done && (
        <form onSubmit={submit}>
          {confirming ? (
            link.action === 'recover' && (
              <>
                <label htmlFor="new-password">Nueva contraseña</label>
                <input id="new-password" name="password" type="password"
                  autoComplete="new-password" minLength={10} maxLength={128} required />
              </>
            )
          ) : (
            <>
              <label htmlFor="account-action">Acción</label>
              <select id="account-action" name="action">
                <option value="recover">Recuperar contraseña</option>
                <option value="verify">Verificar mi correo</option>
              </select>
              <label htmlFor="link-email">Correo institucional para el enlace</label>
              <input id="link-email" name="email" type="email" autoComplete="email" required />
            </>
          )}
          <button disabled={busy}>{confirming ? 'Confirmar' : 'Enviar enlace'}</button>
        </form>
      )}
      {message && (
        <p role={message.error ? 'alert' : 'status'}>{message.text}</p>
      )}
    </section>
  )
}

export function Perfil() {
  const [profile, setProfile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const response = await fetch('/api/profile', { signal: controller.signal })
        if (!response.ok) throw new Error()
        setProfile(await response.json())
      } catch {
        if (!controller.signal.aborted) {
          setMessage({ error: true, text: 'No se pudo cargar el perfil.' })
        }
      }
    }

    load()
    return () => controller.abort()
  }, [])

  async function save(event) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alias: data.get('alias'),
          tripEmailOptIn: data.has('tripEmailOptIn'),
        }),
      })
      const result = await response.json()
      if (response.ok) setProfile(result)
      setMessage({ error: !response.ok, text: response.ok ? 'Perfil guardado.' : result.message })
    } catch {
      setMessage({ error: true, text: 'No se pudo guardar el perfil.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="profile-heading">
      <h2 id="profile-heading">Mi perfil</h2>
      <Reputacion />
      {profile && (
        <form onSubmit={save} key={JSON.stringify(profile)}>
          <label htmlFor="profile-alias">Nombre visible en los viajes</label>
          <input id="profile-alias" name="alias" defaultValue={profile.alias}
            minLength={2} maxLength={40} required />
          <label>
            <input name="tripEmailOptIn" type="checkbox" defaultChecked={profile.tripEmailOptIn}
              style={{ width: 'auto' }} /> Recibir avisos de viajes por correo
          </label>
          <button disabled={busy}>Guardar perfil</button>
        </form>
      )}
      <Penalizaciones />
      <Avisos />
      {message && <p role={message.error ? 'alert' : 'status'}>{message.text}</p>}
    </section>
  )
}
