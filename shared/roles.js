export function sessionRole(session) {
  if (!session) return 'visitante'
  if (session.mobility) return 'movilidad'
  return session.driver ? 'conductor' : 'pasajero'
}
const common = ['inicio','nosotros','ayuda','perfil','seguridad','incidentes','salir']
export function roleView(session, requested) {
  const role = sessionRole(session)
  const exclusive = role === 'conductor' ? ['publicados','vehiculos','solicitudes','historial']
    : role === 'pasajero' ? ['rutas','reservas','historial']
    : role === 'movilidad' ? ['movilidad'] : []
  return common.includes(requested) || exclusive.includes(requested) ? requested : 'inicio'
}
