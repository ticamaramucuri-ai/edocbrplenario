#!/usr/bin/env bun
/**
 * Inicializador do aplicativo desktop edocBR Plenário (servidor local + janela app).
 * Se o cofre ainda não estiver configurado, abre automaticamente o Assistente de Primeiro Acesso.
 * Uso: bun scripts/launch-desktop.ts [raiz-dispositivo] [--port=4310] [--host=0.0.0.0] [--open]
 */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadLocalDevice } from '../src/lib/local-device-keystore'
import { startLocalLanServer } from '../src/lib/local-lan-server'
import { startLocalSetupServer } from '../src/lib/local-desktop-setup'

function parseArgs(argv: string[]) {
  let root = join(homedir(), '.local', 'share', 'edocbr-plenario', 'device')
  let port = 4310
  let hostname = '0.0.0.0'
  let openWindow = false
  for (const arg of argv) {
    if (arg === '--open') openWindow = true
    else if (arg.startsWith('--port=')) port = Number(arg.slice('--port='.length))
    else if (arg.startsWith('--host=')) hostname = arg.slice('--host='.length)
    else if (arg.startsWith('--root=')) root = arg.slice('--root='.length)
    else if (!arg.startsWith('-')) root = arg
  }
  return { root, port, hostname, openWindow }
}

async function resolvePassphrase(passphraseFile: string): Promise<string> {
  const fromEnv = process.env.EDOCBR_LOCAL_PASSPHRASE?.trim()
  if (fromEnv) return fromEnv
  try {
    const fromFile = (await readFile(passphraseFile, 'utf8')).trim()
    if (fromFile) return fromFile
  } catch {
    // sem arquivo de senha
  }
  throw new Error('Cofre local ainda não configurado. Use o Assistente de Primeiro Acesso para começar.')
}

function tryOpenAppWindow(url: string) {
  const candidates: ReadonlyArray<readonly [string, string[]]> = [
    ['chromium', [`--app=${url}`]],
    ['google-chrome-stable', [`--app=${url}`]],
    ['google-chrome', [`--app=${url}`]],
    ['brave', [`--app=${url}`]],
    ['xdg-open', [url]],
  ]
  for (const [bin, args] of candidates) {
    const resolved = Bun.which(bin)
    if (!resolved) continue
    try {
      const child = spawn(resolved, args, { detached: true, stdio: 'ignore' })
      child.on('error', () => {})
      child.unref()
      return resolved
    } catch {
      // tenta próximo
    }
  }
  return null
}

async function startFullServer(args: { root: string; passphrase: string; hostname: string; port: number; openWindow: boolean }) {
  const { config, privateKey, trustedKeys } = await loadLocalDevice({ root: args.root, passphrase: args.passphrase })
  if (!config.deviceId) {
    throw new Error('Dispositivo local não pareado (execute enroll antes).')
  }
  const lan = startLocalLanServer({
    root: args.root,
    tenantId: config.tenantId,
    deviceId: config.deviceId,
    baseUrl: config.baseUrl,
    privateKey,
    trustedKeys,
    hostname: args.hostname,
    port: args.port,
  })
  const baseHost = args.hostname === '0.0.0.0' ? '127.0.0.1' : args.hostname
  const desktopUrl = `http://${baseHost}:${lan.port}/`
  console.log(JSON.stringify({
    status: 'ready',
    desktopUrl,
    telaoUrl: `http://${baseHost}:${lan.port}/telao`,
    vereadorUrl: `http://${baseHost}:${lan.port}/vereador`,
    port: lan.port,
  }))
  if (args.openWindow) {
    tryOpenAppWindow(desktopUrl)
  }
  return lan
}

async function main() {
  const { root, port, hostname, openWindow } = parseArgs(process.argv.slice(2))
  const baseHost = hostname === '0.0.0.0' ? '127.0.0.1' : hostname
  if (port > 0) {
    try {
      const existing = await fetch(`http://${baseHost}:${port}/health`, { signal: AbortSignal.timeout(500) })
      if (existing.ok) {
        const url = `http://${baseHost}:${port}/`
        console.log(JSON.stringify({ status: 'already-running', desktopUrl: url, port }))
        if (openWindow) tryOpenAppWindow(url)
        return
      }
    } catch {
      // porta livre, segue inicialização normal
    }
  }
  const passphraseFile = join(dirname(root), 'passphrase')
  let activeClose: (() => void) | null = null

  try {
    const passphrase = await resolvePassphrase(passphraseFile)
    const lan = await startFullServer({ root, passphrase, hostname, port, openWindow })
    activeClose = () => lan.close()
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    const setup = startLocalSetupServer({
      root,
      passphraseFile,
      reason,
      hostname,
      port,
      onConfigured: async ({ root: configuredRoot, passphrase }) => {
        setup.close()
        const lan = await startFullServer({
          root: configuredRoot,
          passphrase,
          hostname,
          port,
          openWindow: false,
        })
        activeClose = () => lan.close()
      },
    })
    activeClose = () => setup.close()
    const baseHost = hostname === '0.0.0.0' ? '127.0.0.1' : hostname
    const setupUrl = `http://${baseHost}:${setup.port}/`
    console.log(JSON.stringify({ status: 'setup', setupUrl, port: setup.port, reason }))
    if (openWindow) {
      tryOpenAppWindow(setupUrl)
    }
  }

  await new Promise<void>((resolve) => {
    const stop = () => {
      activeClose?.()
      resolve()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
