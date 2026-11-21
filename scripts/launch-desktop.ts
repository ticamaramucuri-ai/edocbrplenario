#!/usr/bin/env bun
/**
 * Inicializador do aplicativo desktop edocBR Plenário (servidor local + janela app).
 * Uso: bun scripts/launch-desktop.ts <raiz-dispositivo> [--port=4310] [--host=127.0.0.1] [--open]
 */
import { spawn } from 'node:child_process'
import { loadLocalDevice } from '../src/lib/local-device-keystore'
import { startLocalLanServer } from '../src/lib/local-lan-server'

function parseArgs(argv: string[]) {
  let root = ''
  let port = 4310
  let hostname = '127.0.0.1'
  let openWindow = false
  for (const arg of argv) {
    if (arg === '--open') openWindow = true
    else if (arg.startsWith('--port=')) port = Number(arg.slice('--port='.length))
    else if (arg.startsWith('--host=')) hostname = arg.slice('--host='.length)
    else if (!root && !arg.startsWith('-')) root = arg
  }
  return { root, port, hostname, openWindow }
}

function tryOpenAppWindow(url: string) {
  const candidates = [
    ['chromium', [`--app=${url}`]],
    ['google-chrome', [`--app=${url}`]],
    ['xdg-open', [url]],
  ] as const
  for (const [bin, args] of candidates) {
    try {
      const child = spawn(bin, [...args], { detached: true, stdio: 'ignore' })
      child.unref()
      return bin
    } catch {
      // tenta próximo
    }
  }
  return null
}

async function main() {
  const { root, port, hostname, openWindow } = parseArgs(process.argv.slice(2))
  if (!root) {
    console.error('Uso: bun scripts/launch-desktop.ts <raiz-dispositivo> [--port=4310] [--host=127.0.0.1] [--open]')
    process.exit(1)
  }
  const passphrase = process.env.EDOCBR_LOCAL_PASSPHRASE?.trim()
  if (!passphrase) {
    console.error('Defina EDOCBR_LOCAL_PASSPHRASE para desbloquear o cofre local.')
    process.exit(1)
  }
  const { config, privateKey, trustedKeys } = await loadLocalDevice({ root, passphrase })
  if (!config.deviceId) {
    console.error('Dispositivo local não pareado (execute enroll antes).')
    process.exit(1)
  }
  const lan = startLocalLanServer({
    root,
    tenantId: config.tenantId,
    deviceId: config.deviceId,
    baseUrl: config.baseUrl,
    privateKey,
    trustedKeys,
    hostname,
    port,
  })
  const baseHost = hostname === '0.0.0.0' ? '127.0.0.1' : hostname
  const desktopUrl = `http://${baseHost}:${lan.port}/`
  console.log(JSON.stringify({
    status: 'ready',
    desktopUrl,
    telaoUrl: `http://${baseHost}:${lan.port}/telao`,
    vereadorUrl: `http://${baseHost}:${lan.port}/vereador`,
    port: lan.port,
  }))
  if (openWindow) {
    tryOpenAppWindow(desktopUrl)
  }
  await new Promise<void>((resolve) => {
    const stop = () => { lan.close(); resolve() }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
