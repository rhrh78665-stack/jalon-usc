import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function report(name, data) {
  const folder = resolve(process.env.JALON_QUALITY_DIR || 'quality-results')
  await mkdir(folder, { recursive: true })
  const result = { measuredAt: new Date().toISOString(), node: process.version, ...data }
  await writeFile(resolve(folder, name + '.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
  return result
}
