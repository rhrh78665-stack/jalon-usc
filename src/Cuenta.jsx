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
    const action = 'recover'
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
      <h2 id="account-links">Recuperar acceso</h2>
      {!done && (
        <form onSubmit={submit}>
          {confirming ? (
              <>
                <label htmlFor="new-password">Nueva contraseña</label>
                <input id="new-password" name="password" type="password"
                  autoComplete="new-password" minLength={10} maxLength={128} required />
              </>
          ) : (
            <>
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
