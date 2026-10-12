/** Relatório somente leitura. Ex.: bun run pilot:preflight --tenant=camara-mucuri-ba */
import { db } from '../src/lib/db'
import { inspectPilotPreflight } from '../src/lib/server/pilot-preflight'

const slug = process.argv.find((arg) => arg.startsWith('--tenant='))?.slice('--tenant='.length)
if (!slug) {
  console.error('Uso: bun run pilot:preflight --tenant=SLUG_DA_CAMARA')
  process.exit(2)
}
try {
  const report = await inspectPilotPreflight(db, slug)
  console.log(JSON.stringify(report, null, 2))
  if (!report.automaticReady) process.exitCode = 2
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha no pré-voo.')
  process.exitCode = 2
} finally {
  await db.$disconnect()
}
