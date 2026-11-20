import { PGlite } from '@electric-sql/pglite'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function openDatabase(path) {
    if (path) await mkdir(dirname(path), { recursive: true })

    const db = new PGlite(path)
    await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      email text NOT NULL UNIQUE,
      password text NOT NULL,
      status text NOT NULL CHECK(status IN ('pending', 'approved', 'rejected'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL
    );
  `)

    return db
}