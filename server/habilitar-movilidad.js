import { resolve } from 'node:path'
import { openDatabase } from './db.js'
import { institutionalEmail, requireRule, RuleError } from './rules.js'

async function enableMobility() {
  const email = institutionalEmail(process.argv[2])
  const db = await openDatabase(resolve('data/pg'))

  try {
    const { rows } = await db.query(
      `UPDATE users SET status = 'approved', mobility = true
       WHERE email = $1 AND (status = 'pending' OR (status = 'approved' AND mobility = true))
       RETURNING id`,
      [email],
    )

    requireRule(rows.length === 1, 'Usa una cuenta pendiente de prueba para habilitar Movilidad.')
    console.log('Cuenta de Movilidad habilitada.')
  } finally {
    await db.close()
  }
}

try {
  await enableMobility()
} catch (error) {
  console.error(error instanceof RuleError ? error.message : 'No se pudo habilitar la cuenta de Movilidad.')
  process.exitCode = 1
}
