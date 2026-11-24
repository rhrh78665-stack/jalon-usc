import { mkdir, writeFile, link, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'

export function configurarCorreo(env, port) {
  if (env.JALON_MAIL_MODE === 'local' && env.NODE_ENV !== 'production') {
    return {
      origin: 'http://127.0.0.1:' + port,
      async send(message, { idempotencyKey } = {}) {
        const folder = 'data/outbox'
        await mkdir(folder, { recursive: true })
        const filename = idempotencyKey ? createHash('sha256').update(idempotencyKey).digest('hex') : randomUUID()

        const temporary = join(folder, '.' + randomUUID() + '.tmp')
        try {
          await writeFile(temporary,
            `Para: ${message.to}\nAsunto: ${message.subject}\n\n${message.text}\n`,
            { flag: 'wx', mode: 0o600 })
          try { await link(temporary, join(folder, filename + '.txt')) }
          catch (error) { if (error.code !== 'EEXIST') throw error }
        } finally {
          await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
        }
      },
    }
  }

  if (!env.RESEND_API_KEY) return null
  const origin = new URL(env.JALON_PUBLIC_URL)
  if (origin.protocol !== 'https:' || !env.JALON_MAIL_FROM) {
    throw new Error('Configura JALON_PUBLIC_URL con HTTPS y JALON_MAIL_FROM.')
  }

  return {
    origin: origin.origin,
    async send(message, { idempotencyKey } = {}) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + env.RESEND_API_KEY,
          'Content-Type': 'application/json',
          ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }),
        },
        body: JSON.stringify({ from: env.JALON_MAIL_FROM, ...message }),
        signal: AbortSignal.timeout(8000),
      })
      await response.body?.cancel()
      if (!response.ok) throw new Error('El proveedor de correo rechazó el envío.')
    },
  }
}
