/** Worker separado. Supervisionar como serviço; --once permite teste e execução manual. */
import { reconcileMediaIntentsOnce } from '../src/lib/server/media-reconciliation'
import { db } from '../src/lib/db'
import { randomUUID } from 'node:crypto'
import { beatMediaWorker } from '../src/lib/server/media-operations'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória.')
const once = process.argv.includes('--once')
const owner = randomUUID()
let stopping = false
process.on('SIGINT', () => { stopping = true })
process.on('SIGTERM', () => { stopping = true })

// A batida é independente de ciclos longos. --once é diagnóstico e não
// anuncia um worker permanente ao monitoramento.
let beating = false
const timer = once ? null : setInterval(() => {
  if (beating || stopping) return
  beating = true
  void beatMediaWorker(owner).catch(() => {
    process.stderr.write(`${new Date().toISOString()} media: heartbeat indisponível\n`)
  }).finally(() => { beating = false })
}, 10_000)

try {
  if (!once) await beatMediaWorker(owner)
  do {
    const result = await reconcileMediaIntentsOnce()
    if (!once) await beatMediaWorker(owner, true)
    if (result.claimed) process.stdout.write(`${new Date().toISOString()} media: ${JSON.stringify(result)}\n`)
    if (once || stopping) break
    await Bun.sleep(3000)
  } while (!stopping)
} finally {
  if (timer) clearInterval(timer)
  await db.$disconnect()
}
