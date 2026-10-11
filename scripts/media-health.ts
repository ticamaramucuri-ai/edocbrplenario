/** Consulta local para systemd/monitor externo. Código 0: saudável; 2: degradado; 3: consulta falhou. */
import { db } from '../src/lib/db'
import { readMediaOperationsHealth } from '../src/lib/server/media-operations'

try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente')
  const health = await readMediaOperationsHealth()
  process.stdout.write(`${JSON.stringify(health)}\n`)
  if (!health.ok) process.exitCode = 2
} catch {
  process.stdout.write(`${JSON.stringify({ ok: false, reasons: ['health_check_failed'] })}\n`)
  process.exitCode = 3
} finally {
  await db.$disconnect()
}
