import { requireRule } from './rules.js'

export function accountRole(user) {
  if (user.mobility) return 'movilidad'
  return (user.driverAssigned ?? user.driver) ? 'conductor' : 'pasajero'
}
export function requirePassenger(user) {
  requireRule(accountRole(user) === 'pasajero',
    'Esta función pertenece al rol Pasajero. El conductor gestiona sus propias ofertas y solicitudes recibidas.', 403)
}
export function requireConductor(user) {
  requireRule(accountRole(user) === 'conductor', 'Esta función pertenece al rol Conductor.', 403)
}
