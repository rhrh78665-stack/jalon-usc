export function journeyIdentity(trip) {
  return {
    driver: { name: trip.driverName || 'Conductor USC' },
    vehicle: {
      brand: trip.brand || '', model: trip.model || '', color: trip.color || '', plate: trip.plate || '',
      photoUrl: trip.hasPhoto ? '/api/vehicles/' + encodeURIComponent(trip.vehicleId) + '/photo' : null,
      photoReference: Boolean(trip.photoReference),
    },
  }
}

export async function journeyProfile(db, id) {
  const { rows: [row] } = await db.query(
    `SELECT u.alias AS "driverName", v.id AS "vehicleId", v.brand, v.model, v.color, v.plate,
      v.photo_data IS NOT NULL AS "hasPhoto", v.photo_reference AS "photoReference"
     FROM trips t JOIN users u ON u.id = t.driver_id JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = $1`, [id],
  )
  return journeyIdentity(row || {})
}
