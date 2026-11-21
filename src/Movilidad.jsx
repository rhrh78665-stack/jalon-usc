import React, { useEffect, useState } from 'react'

export default function Movilidad() {
    const [requests, setRequests] = useState(null)
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState(null)

    useEffect(() => {
        const controller = new AbortController()

        async function loadRequests() {
            try {
                const response = await fetch('/api/movilidad/solicitudes', { signal: controller.signal })
                const data = await response.json()

                if (response.ok) {
                    setRequests(data)
                } else {
                    setMessage({ error: true, text: data.message })
                }
            } catch {
                if (!controller.signal.aborted) {
                    setMessage({ error: true, text: 'No se pudieron cargar las solicitudes.' })
                }
            }
        }

        loadRequests()
        return () => controller.abort()
    }, [])

    async function review(event, userId) {
        event.preventDefault()
        const fields = Object.fromEntries(new FormData(event.currentTarget))
        setMessage(null)
        setBusy(true)

        try {
            const response = await fetch('/api/movilidad/solicitudes/' + encodeURIComponent(userId), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fields),
            })
            const data = await response.json()

            if (!response.ok) {
                setMessage({ error: true, text: data.message })
                return
            }

            setRequests(current => current.filter(request => request.id !== userId))
            setMessage({ text: data.status === 'approved' ? 'Cuenta aprobada.' : 'Cuenta rechazada.' })
        } catch {
            setMessage({ error: true, text: 'No se pudo guardar la decisión.' })
        } finally {
            setBusy(false)
        }
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