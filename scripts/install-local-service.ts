#!/usr/bin/env bun
/**
 * Gerador/instalador de serviço residente systemd (--user) para o servidor local LAN.
 * Uso: bun scripts/install-local-service.ts <raiz-dispositivo> [--port=4310] [--apply]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

function parseArgs(argv: string[]) {
  let root = ''
  let port = 4310
  let apply = false
  for (const arg of argv) {
    if (arg === '--apply') apply = true
    else if (arg.startsWith('--port=')) port = Number(arg.slice('--port='.length))
    else if (!root && !arg.startsWith('-')) root = arg
  }
  return { root, port, apply }
}

async function main() {
  const { root, port, apply } = parseArgs(process.argv.slice(2))
  if (!root) {
    console.error('Uso: bun scripts/install-local-service.ts <raiz-dispositivo> [--port=4310] [--apply]')
    process.exit(1)
  }
  const repoDir = resolve(import.meta.dir, '..')
  const bunBin = process.execPath
  const unit = `[Unit]
Description=edocBR Plenário Desktop — Servidor Local LAN
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${repoDir}
ExecStart=${bunBin} scripts/local-server.ts serve ${resolve(root)} ${port} 0.0.0.0
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`
  const unitDir = join(homedir(), '.config', 'systemd', 'user')
  const unitPath = join(unitDir, 'edocbr-plenario-local.service')
  const desktopDir = join(homedir(), '.local', 'share', 'applications')
  const desktopPath = join(desktopDir, 'edocbr-plenario-desktop.desktop')
  const desktopEntry = `[Desktop Entry]
Type=Application
Name=edocBR Plenário Desktop
Comment=Mesa de Condução Local e Servidor LAN do Plenário
Exec=${bunBin} ${join(repoDir, 'scripts', 'launch-desktop.ts')} ${resolve(root)} --port=${port} --open
Terminal=false
Categories=Office;Utility;
`
  if (apply) {
    await mkdir(unitDir, { recursive: true })
    await writeFile(unitPath, unit, { mode: 0o644 })
    await mkdir(desktopDir, { recursive: true })
    await writeFile(desktopPath, desktopEntry, { mode: 0o644 })
    console.log(JSON.stringify({ installed: true, unitPath, desktopPath, next: 'systemctl --user daemon-reload && systemctl --user enable --now edocbr-plenario-local.service' }))
  } else {
    console.log(unit)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

