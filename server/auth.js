import { argon2, randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import { requireRule } from './rules.js'

const derive = promisify(argon2)
const argonOptions = {
    parallelism: 1,
    tagLength: 32,
    memory: 19_456,
    passes: 2,
}

export async function hashPassword(password) {
    requireRule(
        typeof password === 'string' &&
        password.length >= 10 &&
        password.length <= 128,
        'La contraseña debe tener entre 10 y 128 caracteres.',
    )

    const nonce = randomBytes(16)
    const tag = await derive('argon2id', {
        ...argonOptions,
        nonce,
        message: Buffer.from(password),
    })

    return nonce.toString('hex') + ':' + tag.toString('hex')
}