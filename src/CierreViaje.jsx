import { pointName } from '../shared/route-points.js'
import React, { useEffect, useState } from 'react'
import { api, nombreParada, pesos } from './Itinerario.jsx'

export default function CierreViaje({ trip }) {
  const [cierre, setCierre] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const visible = ['EnCurso', 'Completado'].includes(trip.status)
  const url = `/api/trips/${encodeURIComponent(trip.id)}`

  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    api(url + '/cierre', { signal: controller.signal })
      .then(setCierre)
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [url, visible, trip.status])

  async function cambiar(action, asistencia) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api(url + '/' + action, {
        method: action === 'attendance' ? 'PATCH' : 'POST',
        ...(asistencia && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asistencia }) }),
      })
      if (action === 'attendance') setNotice('Asistencia guardada. Puedes continuar y liquidar al finalizar.')
      window.dispatchEvent(new Event('jalon-trips-update'))
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {['Programado', 'Lleno'].includes(trip.status) && (
        <button type="button" disabled={busy} onClick={() => cambiar('start')}>Iniciar viaje</button>
      )}
      {trip.status === 'EnCurso' && cierre && (
        <form onSubmit={event => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          const action = event.nativeEvent.submitter?.value === 'attendance' ? 'attendance' : 'finish'
          cambiar(action, cierre.reservas.map(r => ({ id: r.id, attendance: data.get(r.id) })))
        }}>
          {cierre.reservas.map(r => (
            <label key={r.id}>
              Asistencia de {r.alias}
              <select name={r.id} defaultValue={r.attendance ?? ''} required>
                <option value="">Selecciona asistencia</option>
                <option value="Abordo">Abordó</option>
                <option value="Ausente">No se presentó</option>
              </select>
            </label>
          ))}
          <button name="action" value="attendance" className="secondary" disabled={busy}>Guardar asistencia</button>
          <button name="action" value="finish" disabled={busy}>Finalizar y liquidar</button>
        </form>
      )}
      {trip.status === 'Completado' && cierre?.liquidation && (
        <div>
          <p>{['fixed-fare','distance-v2'].includes(cierre.liquidation.mode) ? 'Total de los pasajeros: ' : 'Total liquidado: '}{pesos.format(cierre.liquidation.totalCop)}</p>
          {cierre.liquidation.tramos && (
            <ul aria-label="Desglose de liquidación">
              {cierre.liquidation.tramos.map(tramo => (
                <li key={tramo.desde}>
                  {pointName(trip,tramo.desde)} → {pointName(trip,tramo.hasta)} · {pesos.format(tramo.recaudoCop ?? (tramo.costoCop - tramo.conductorCop))}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
