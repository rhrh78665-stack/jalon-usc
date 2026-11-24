import Reputacion from './Reputacion.jsx'
import React, { useEffect, useState } from 'react'
import { api, horaLocal, nombreParada, pesos } from './Itinerario.jsx'

export default function Reservas() {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(null)

  useEffect(() => {
    let controller
    async function cargar() {
      controller?.abort()
      const request = new AbortController()
      controller = request
      try {
        const reservations = await api('/api/reservations', { signal: request.signal })
        if (!request.signal.aborted) {
          setItems(reservations)
          setError('')
        }
      } catch (failure) {
        if (!request.signal.aborted) setError(failure.message)
      }
    }
    cargar()
    window.addEventListener('jalon-reservas-update', cargar)
    window.addEventListener('jalon-trips-update', cargar)
    return () => {
      controller?.abort()
      window.removeEventListener('jalon-reservas-update', cargar)
      window.removeEventListener('jalon-trips-update', cargar)
    }
  }, [])

  async function actualizar(id, action, options) {
    setSaving(id)
    setError('')
    try {
      await api(`/api/reservations/${encodeURIComponent(id)}/${action}`, options)
      window.dispatchEvent(new Event('jalon-trips-update'))
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSaving(null)
    }
  }

  function decidir(id, decision) {
    return actualizar(id, 'decision', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
    })
  }

  return (
    <section aria-labelledby="reservations-heading">
      <h2 id="reservations-heading">Reservas</h2>
      {error && <p role="alert">{error}</p>}
      {!items.length && !error && <p>Aún no hay reservas.</p>}
      <ul className="trip-list" aria-live="polite">
        {items.map(booking => (
          <li key={booking.id} data-reservation-id={booking.id}>
            <strong>{nombreParada[booking.origin]} → {nombreParada[booking.destination]}</strong>
            <p>{booking.canDecide ? 'Solicitud recibida' : 'Mi solicitud'}{' '}<span className="booking-status" data-status={booking.status}>{booking.status}</span></p>
            {booking.boardAt && <p>Recogida: {horaLocal.format(new Date(booking.boardAt))}</p>}
            <Reputacion userId={booking.counterpartId} />
            <p>Aporte máximo: {pesos.format(booking.maximumCop)}</p>
            {booking.aporteFinalCop != null && <p>Aporte definitivo: {pesos.format(booking.aporteFinalCop)}</p>}
            {booking.compensacionCop != null && (
              <p>Pago externo registrado: {pesos.format(booking.compensacionCop)} · {booking.compensacionConfirmadaEn ? 'Confirmado' : 'Pendiente de confirmación'}</p>
            )}
            {!booking.canDecide && booking.compensacionCop != null && !booking.compensacionConfirmadaEn && (
              <button type="button" disabled={saving !== null}
                onClick={() => actualizar(booking.id, 'compensation/confirm', { method: 'POST' })}>Confirmar pago externo</button>
            )}
            {booking.canDecide && booking.aporteFinalCop > 0 && booking.compensacionCop == null && (
              <form onSubmit={event => {
                event.preventDefault()
                const montoCop = Number(new FormData(event.currentTarget).get('montoCop'))
                actualizar(booking.id, 'compensation', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ montoCop }),
                })
              }}>
                <label>Monto recibido en COP
                  <input name="montoCop" type="number" min="1" max={booking.aporteFinalCop} step="1" required />
                </label>
                <button disabled={saving !== null}>Registrar pago externo</button>
              </form>
            )}
            {booking.canRate && (
              <form onSubmit={event => {
                event.preventDefault()
                const data = new FormData(event.currentTarget)
                actualizar(booking.id, 'rating', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ stars: Number(data.get('stars')), review: data.get('review') }),
                })
              }}>
                <label>Estrellas para {booking.contraparte}
                  <select name="stars" defaultValue="" required>
                    <option value="">Selecciona</option>
                    {[1, 2, 3, 4, 5].map(star => <option key={star}>{star}</option>)}
                  </select>
                </label>
                <label>Reseña <textarea name="review" minLength={1} maxLength={300} required /></label>
                <button disabled={saving !== null}>Publicar reseña</button>
              </form>
            )}
            {booking.misEstrellas != null && <p>Tu calificación: {booking.misEstrellas}/5 · {booking.miResena}</p>}
            {booking.canCancel && (
              <button type="button" disabled={saving !== null} onClick={() => actualizar(booking.id, 'cancel', { method: 'POST' })}>
                Cancelar mi reserva
              </button>
            )}
            {booking.canDecide && booking.status === 'Pendiente' && (
              <div className="actions">
                <button type="button" disabled={saving !== null} onClick={() => decidir(booking.id, 'confirmar')}>Confirmar</button>
                <button type="button" disabled={saving !== null} onClick={() => decidir(booking.id, 'rechazar')}>Rechazar</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
