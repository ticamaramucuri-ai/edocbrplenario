#!/usr/bin/env bun
/** Laboratory operator preview. Loopback-only, read-only; never grants local session authority. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadLocalDevice } from '../src/lib/local-device-keystore'
import { inspectLocalPreparations } from '../src/lib/local-preparation-status'
import { readLocalServiceCredential } from '../src/lib/local-service-credential'
import { createLocalPreflightView, localPreflightHandler } from '../src/lib/local-preflight-preview'
import { readLocalSessionSummary } from '../src/lib/local-session-summary'

async function main(): Promise<void> {
  const [root, credential, portText = '3185'] = process.argv.slice(2)
  if (!root || !credential) throw new Error('Uso: bun scripts/local-app.ts <raiz-absoluta> <credencial-absoluta> [porta]')
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 0 || port > 65535 || (port !== 0 && port < 1024)) {
    throw new Error('Porta deve ser 0 para ensaio ou estar entre 1024 e 65535.')
  }
  const passphrase = await readLocalServiceCredential(credential)
  const { config, trustedKeys } = await loadLocalDevice({ root, passphrase })
  const appRoot = join(import.meta.dir, '../src/local-app')
  const [html, script, css] = await Promise.all(['index.html', 'app.js', 'app.css']
    .map((file) => readFile(join(appRoot, file), 'utf8')))
  const fetch = localPreflightHandler({ html, script, css,
    readSummary: (sessionId) => readLocalSessionSummary({ root, tenantId: config.tenantId,
      sessionId, trustedKeys }),
    readView: async () => createLocalPreflightView({ tenantId: config.tenantId,
      deviceId: config.deviceId!, sessions: await inspectLocalPreparations({ root,
        tenantId: config.tenantId, trustedKeys }) }) })
  const server = Bun.serve({ hostname: '127.0.0.1', port, fetch })
  process.stdout.write(JSON.stringify({ url: `http://127.0.0.1:${server.port}`, mode: 'read_only' }) + '\n')
  const stop = () => { server.stop(); process.exitCode = 0 }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Não foi possível iniciar a prévia local.')
  process.exitCode = 1
})
