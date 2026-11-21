import React, { useEffect, useState } from 'react'

const base = '/api/movilidad'

export default function Movilidad() {
    const [requests, setRequests] = useState(null)
    const [drivers, setDrivers] = useState(null)
    const [revision, setRevision] = useState(0)
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState(null)

    useEffect(() => {
        const controller = new AbortController()

        async function load(resource, setData) {
            try {
                const response = await fetch(base + '/' + resource, { signal: controller.signal })
                const data = await response.json()
                if (controller.signal.aborted) return

                if (response.ok) {
                    setData(data)
                } else {
                    setMessage({ error: true, text: data.message })
                }
            } catch {
                if (!controller.signal.aborted) {
                    setMessage({ error: true, text: 'No se pudo cargar el panel de Movilidad.' })
                }
            }
        }

        load('solicitudes', setRequests)
        load('conductores', setDrivers)
        return () => controller.abort()
    }, [revision])

    async function save(event, resource, id, successText) {
        event.preventDefault()
        const fields = Object.fromEntries(new FormData(event.currentTarget))
        setMessage(null)
        setBusy(true)

        try {
            const response = await fetch(base + '/' + resource + '/' + encodeURIComponent(id), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fields),
            })
            const data = await response.json()

            if (!response.ok) {
                setMessage({ error: true, text: data.message })
                return
            }

            setRevision(current => current + 1)
            setMessage({ text: successText(data) })
        } catch {
            setMessage({ error: true, text: 'No se pudo guardar la decisión.' })
        } finally {
            setBusy(false)
        }
    }

    function review(event, id) {
        return save(event, 'solicitudes', id, data =>
            data.status === 'approved' ? 'Cuenta aprobada.' : 'Cuenta rechazada.',
        )
    }

    function enableDriver(event, id) {
        return save(event, 'conductores', id, () => 'Conductor habilitado.')
    }

    return (
        <section aria-label="Movilidad">
            <h2>Solicitudes de vinculación</h2>

            {requests === null && !message && <p>Cargando solicitudes…</p>}
            {requests?.length === 0 && <p>No hay solicitudes pendientes.</p>}

            {requests?.map(request => (
                <form key={request.id} onSubmit={event => review(event, request.id)}>
                    <h3>{request.email}</h3>

                    <label>
                        Código universitario
                        <input name="code" inputMode="numeric" pattern="[0-9]{5,12}" maxLength={12} required />
                    </label>

                    <label>
                        Rol declarado
                        <select name="role" required defaultValue="">
                            <option value="" disabled>Selecciona el rol</option>
                            <option value="estudiante">Estudiante</option>
                            <option value="docente">Docente</option>
                            <option value="administrativo">Administrativo</option>
                        </select>
                    </label>

                    <label>
                        Decisión
                        <select name="decision" required defaultValue="">
                            <option value="" disabled>Selecciona una decisión</option>
                            <option value="approved">Aprobar</option>
                            <option value="rejected">Rechazar</option>
                        </select>
                    </label>

                    <button disabled={busy}>Guardar decisión</button>
                </form>
            ))}

            <h2>Habilitación de conductores</h2>

            {drivers === null && !message && <p>Cargando miembros aprobados…</p>}
            {drivers?.length === 0 && <p>No hay miembros aprobados.</p>}

            {drivers?.map(driver => (
                <form key={driver.id} onSubmit={event => enableDriver(event, driver.id)}>
                    <h3>{driver.email}</h3>
                    <p>{driver.enabled ? 'Habilitado hasta ' + driver.expiresOn : 'Sin permiso vigente'}</p>

                    <label>
                        Vencimiento de licencia de prueba
                        <input
                            name="expiresOn"
                            type="date"
                            defaultValue={driver.expiresOn ?? ''}
                            required
                        />
                    </label>

                    <button disabled={busy}>Habilitar conductor</button>
                </form>
            ))}

            {message && (
                <p
                    className={message.error ? 'notice error' : 'notice'}
                    role={message.error ? 'alert' : 'status'}
                >
                    {message.text}
                </p>
            )}
        </section>
    )
}