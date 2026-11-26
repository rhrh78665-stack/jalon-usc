export async function prepareVehiclePhoto(file) {
  if (!file) return undefined
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Selecciona una foto JPEG, PNG o WebP de hasta 8 MB.')
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    const ratio = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const quality of [.82, .65, .45]) {
      const value = canvas.toDataURL('image/jpeg', quality)
      if (value.length <= 260000) return value
    }
    throw new Error('La foto contiene demasiado detalle. Prueba con otra fotografía más pequeña.')
  } finally { bitmap.close() }
}
