import React, { useEffect, useState } from 'react'

export default function Vehiculos() {
    const [vehicles, setVehicles] = useState(null)
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState({ text: 'Cargando vehículos…' })

    useEffect(() => {
        const controller = new AbortController()

        async function loadVehicles() {
            try {
                const response = await fetch('/api/vehicles', { signal: controller.signal })
                const result = await response.json()
                if (!response.ok) {
                    setMessage({ error: response.status !== 403, text: result.message })
                    return
                }
                setVehicles(result)
                setMessage(null)
            } catch {
                if (!controller.signal.aborted) {
                    setMessage({ error: true, text: 'No se pudieron cargar los vehículos.' })
                }
            }
        }

        loadVehicles()
        return () => controller.abort()
    }, [])

    async function registerVehicle(event) {
        event.preventDefault()
        const form = event.currentTarget
        const fields = new FormData(form)
        setSaving(true)
        setMessage(null)

        try {
            const response = await fetch('/api/vehicles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    plate: fields.get('plate'),
                    seats: Number(fields.get('seats')),
                    efficiency: Number(fields.get('efficiency')),
                }),
            })
            const result = await response.json()

            if (!response.ok) {
                if (response.status === 403) setVehicles(null)
                setMessage({ error: true, text: result.message })
                return
            }

            form.reset()
            setVehicles(current => [...current, result].sort((a, b) => a.plate.localeCompare(b.plate)))
            setMessage({ text: 'Vehículo registrado.' })
        } catch {
            setMessage({ error: true, text: 'No se pudo registrar el vehículo. Inténtalo de nuevo.' })
        } finally {
            setSaving(false)
        }
    }

    return (
        <section aria-labelledby="vehicle-heading">
            <h2 id="vehicle-heading">Mis vehículos</h2>
            {vehicles && (
                <>
                    {vehicles.length ? (
                        <ul>
                            {vehicles.map(({ id, plate, seats, efficiency }) => (
                                <li key={id}>{plate} · {seats} asientos · {efficiency.toLocaleString('es-CO')} km/gal</li>
                            ))}
                        </ul>
                    ) : <p>Aún no has registrado vehículos.</p>}

                    <form onSubmit={registerVehicle} aria-busy={saving}>
                        <label htmlFor="vehicle-plate">Placa</label>
                        <input id="vehicle-plate" name="plate" placeholder="ABC123"
                            pattern="[A-Za-z]{3}[0-9]{3}" maxLength={6} autoCapitalize="characters" required />

                        <label htmlFor="vehicle-seats">Asientos disponibles</label>
                        <input id="vehicle-seats" name="seats" type="number" min="1"
                            max="2147483647" step="1" required />

                        <label htmlFor="vehicle-efficiency">Rendimiento (km/gal)</label>
                        <input id="vehicle-efficiency" name="efficiency" type="number"
                            min="0" step="any" required />

                        <button disabled={saving}>{saving ? 'Guardando…' : 'Registrar vehículo'}</button>
                    </form>
                </>
            )}
            {message && (
                <p className={message.error ? 'notice error' : 'notice'}
                    role={message.error ? 'alert' : 'status'}>{message.text}</p>
            )}
        </section>
    )
}