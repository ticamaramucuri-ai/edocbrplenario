#!/usr/bin/env bun
/** Operator entrypoint for the local synchronization process. No LAN authority yet. */
import { readFile } from 'node:fs/promises'
import { initializeLocalDevice, enrollLocalDevice, trustLocalTransferKey, loadLocalDevice } from '../src/lib/local-device-keystore'
import { synchronizePreparedSessions } from '../src/lib/local-session-discovery'
import { readLocalServiceCredential } from '../src/lib/local-service-credential'
import { inspectLocalPreparations } from '../src/lib/local-preparation-status'

const usage = 'Uso: bun scripts/local-server.ts init <raiz-absoluta> <tenantId> <https-baseUrl> | enroll <raiz> <deviceId> | trust <raiz> <keyId> <chave-publica.pem> <sha256-spki> | status <raiz> | sync <raiz> | run <raiz> [intervalo-segundos] | run-credential <raiz> <arquivo-credencial-absoluto> [intervalo-segundos]'

async function readSecret(): Promise<string> {
  if (!process.stdin.isTTY) {
    let value = ''
    for await (const chunk of process.stdin) {
      value += chunk.toString()
      if (value.length > 4096) throw new Error('Entrada de segredo excede o limite.')
    }
    return value.replace(/\r?\n$/, '')
  }
  const stdin = process.stdin
  if (!stdin.setRawMode) throw new Error('Terminal não permite entrada oculta de segredo.')
  process.stderr.write('Frase secreta do servidor local: ')
  return new Promise<string>((resolveSecret, reject) => {
    let value = ''
    const finish = (error?: Error) => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      process.stderr.write('\n')
      if (error) reject(error)
      else resolveSecret(value)
    }
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') { finish(); return }
        if (char === '\u0003') { finish(new Error('Operação interrompida.')); return }
        if (char === '\u007f' || char === '\b') { value = [...value].slice(0, -1).join(''); continue }
        if (value.length >= 4096) { finish(new Error('Frase secreta excede o limite.')); return }
        value += char
      }
    }
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onData)
  })
}

function emit(value: unknown): void { process.stdout.write(JSON.stringify(value) + '\n') }

async function syncOnce(root: string, passphrase: string, signal?: AbortSignal): Promise<void> {
  const { config, privateKey, trustedKeys } = await loadLocalDevice({ root, passphrase })
  const result = await synchronizePreparedSessions({ baseUrl: config.baseUrl,
    tenantId: config.tenantId, deviceId: config.deviceId!, privateKey, trustedKeys,
    localRoot: root, signal })
  emit({ at: new Date().toISOString(), prepared: result.prepared.map((item) => ({
    sessionId: item.sessionId, revisionId: item.revisionId, revisionNumber: item.revisionNumber })),
    skipped: result.skipped, failed: result.failed })
}

async function waitInterval(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolveWait) => {
    const timeout = setTimeout(done, ms)
    function done() { clearTimeout(timeout); signal.removeEventListener('abort', done); resolveWait() }
    signal.addEventListener('abort', done, { once: true })
    if (signal.aborted) done()
  })
}

async function main(): Promise<void> {
  const [command, root, arg1, arg2, arg3] = process.argv.slice(2)
  if (!command || !root) throw new Error(usage)
  if (command === 'init') {
    if (!arg1 || !arg2) throw new Error(usage)
    const result = await initializeLocalDevice({ root, tenantId: arg1, baseUrl: arg2,
      passphrase: await readSecret() })
    emit({ tenantId: result.config.tenantId, publicKeySpkiSha256: result.config.publicKeySpkiSha256,
      publicKeyPem: result.publicKeyPem, next: 'Registre e designe esta chave pública no SaaS; depois execute enroll e trust.' })
    return
  }
  if (command === 'enroll') {
    if (!arg1) throw new Error(usage)
    const config = await enrollLocalDevice(root, arg1)
    emit({ tenantId: config.tenantId, deviceId: config.deviceId })
    return
  }
  if (command === 'trust') {
    if (!arg1 || !arg2 || !arg3) throw new Error(usage)
    const publicKeyPem = await readFile(arg2, 'utf8')
    const fingerprint = await trustLocalTransferKey({ root, keyId: arg1, publicKeyPem,
      expectedSpkiSha256: arg3 })
    emit({ keyId: arg1, publicKeySpkiSha256: fingerprint })
    return
  }
  if (command !== 'status' && command !== 'sync' && command !== 'run' && command !== 'run-credential') throw new Error(usage)
  if (command === 'run-credential' && !arg1) throw new Error(usage)
  const passphrase = command === 'run-credential' ? await readLocalServiceCredential(arg1!) : await readSecret()
  if (command === 'status') {
    const { config, trustedKeys } = await loadLocalDevice({ root, passphrase })
    const sessions = await inspectLocalPreparations({ root, tenantId: config.tenantId, trustedKeys })
    emit({ tenantId: config.tenantId, sessions })
    if (sessions.some((session) => session.state === 'corrupt')) process.exitCode = 2
    return
  }
  if (command === 'sync') { await syncOnce(root, passphrase); return }
  const interval = command === 'run-credential' ? arg2 : arg1
  const seconds = interval === undefined ? 60 : Number(interval)
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3600) throw new Error('Intervalo deve estar entre 30 e 3600 segundos.')
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())
  while (!controller.signal.aborted) {
    try { await syncOnce(root, passphrase, controller.signal) }
    catch (error) {
      if (!controller.signal.aborted) console.error(`[local-sync] ${error instanceof Error ? error.message : 'Falha desconhecida'}`)
    }
    await waitInterval(seconds * 1000, controller.signal)
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Falha desconhecida'); process.exitCode = 1 })
