import { requireRule } from './rules.js'

export function vehicleDescription(body) {
  const values = {}
  for (const [key, limit] of [['brand', 40], ['model', 60], ['color', 30]]) {
    const value = body[key] ?? ''
    requireRule(typeof value === 'string' && value.trim().length <= limit && !/[\p{Cc}\p{Cf}<>]/u.test(value), 'Revisa la marca, el modelo y el color.')
    values[key] = value.trim()
  }
  const photoData = body.photoData ?? null
  if (photoData !== null) {
    requireRule(typeof photoData === 'string' && photoData.length <= 280000, 'La foto supera el tamaño permitido.')
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photoData)
    requireRule(match && match[2].length % 4 === 0, 'Selecciona una fotografía JPEG, PNG o WebP válida.')
    const buffer = Buffer.from(match[2], 'base64')
    const valid = match[1] === 'jpeg' ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
      : match[1] === 'png' ? buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
      : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
    requireRule(valid && buffer.length >= 24 && buffer.length <= 200000, 'La fotografía no tiene un formato o tamaño permitido.')
  }
  return { ...values, photoData }
}
