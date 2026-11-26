import React, { useEffect, useState } from 'react'
import { defaultFare, maximumFareCop } from '../shared/fare-policy.js'
import { precioGalonDemo, tramos } from '../shared/paradas.js'
import { api, nombreParada } from './Itinerario.jsx'

export default function Tarifas() {
  const [tarifa, setTarifa] = useState(undefined)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    api('/api/trips/tarifa', { signal: controller.signal }).then(setTarifa)
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [])

  async function guardar(event) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const saved = await api('/api/movilidad/tarifas/nueva', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fuelPriceCopPerGallon: Number(data.get('fuel')),
          fare: { minimumCop: Number(data.get('minimum')), perKmCop: Number(data.get('perKm')) },
          tolls: Object.fromEntries(tramos.map(({ from, to }) => {
            const key = from + ':' + to
            return [key, Number(data.get(key))]
          })),
        }),
      })
      setTarifa(saved)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h3>Tarifas para nuevas publicaciones</h3>
      {error && <p role="alert">{error}</p>}
      {tarifa && <p role="status">Versión vigente: {tarifa.version}</p>}
      {tarifa !== undefined && (
        <form key={tarifa?.version ?? 'demo'} onSubmit={guardar}>
          <div className="tariff-fields">
            <label>Tarifa mínima por reserva y persona (COP)
              <input name="minimum" type="number" min="11000" max={maximumFareCop} step="1" defaultValue={tarifa?.fare?.minimumCop ?? defaultFare.minimumCop} required />
            </label>
            <label>Tarifa por kilómetro (COP)
              <input name="perKm" type="number" min="100" max="100000" step="1" defaultValue={tarifa?.fare?.perKmCop ?? defaultFare.perKmCop} required />
            </label>
          </div>
          <p className="tariff-note">El valor por persona tiene un límite de $25.000 COP por reserva. La versión nueva se aplica a los próximos viajes publicados. Las reservas existentes conservan el valor que aceptaron.</p>
          <label>Precio de combustible por galón (COP)
            <input name="fuel" type="number" min="1" step="1" defaultValue={tarifa?.fuelPriceCopPerGallon ?? precioGalonDemo} required />
          </label>
          {tramos.map(({ from, to, tollCop }) => {
            const key = from + ':' + to
            return (
              <label key={key}>Peaje {nombreParada[from]} — {nombreParada[to]} (COP)
                <input name={key} type="number" min="0" step="1" defaultValue={tarifa?.tolls[key] ?? tollCop} required />
              </label>
            )
          })}
          <button disabled={busy}>Guardar nueva versión</button>
        </form>
      )}
    </section>
  )
}
