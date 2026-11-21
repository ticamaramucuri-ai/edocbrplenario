#!/usr/bin/env bun
/**
 * Empacota o edocBR Plenário Desktop em binários standalone Linux x64 + instalador + .tar.gz
 * sem necessidade de repositório ou Bun instalados na máquina da Câmara.
 */
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const repoDir = resolve(import.meta.dir, '..')
const outDir = join(repoDir, 'dist', 'desktop')

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const desktopBin = join(outDir, 'edocbr-plenario-desktop')
  const cliBin = join(outDir, 'edocbr-plenario-cli')

  execFileSync(
    process.execPath,
    ['build', '--compile', '--minify', join(repoDir, 'scripts', 'launch-desktop.ts'), '--outfile', desktopBin],
    { cwd: repoDir, stdio: 'inherit' }
  )

  execFileSync(
    process.execPath,
    ['build', '--compile', '--minify', join(repoDir, 'scripts', 'local-server.ts'), '--outfile', cliBin],
    { cwd: repoDir, stdio: 'inherit' }
  )

  const installSh = `#!/usr/bin/env bash
set -euo pipefail

BIN_DIR="\${HOME}/.local/bin"
APP_DIR="\${HOME}/.local/share/applications"
DATA_DIR="\${HOME}/.local/share/edocbr-plenario"
HERE="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "\${BIN_DIR}" "\${APP_DIR}" "\${DATA_DIR}"
install -m 0755 "\${HERE}/edocbr-plenario-desktop" "\${BIN_DIR}/edocbr-plenario-desktop"
install -m 0755 "\${HERE}/edocbr-plenario-cli" "\${BIN_DIR}/edocbr-plenario-cli"

cat > "\${APP_DIR}/edocbr-plenario-desktop.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=edocBR Plenário Desktop
Comment=Mesa de Condução Local e Servidor LAN do Plenário
Exec=\${BIN_DIR}/edocbr-plenario-desktop --open
Terminal=false
Categories=Office;Utility;
EOF

echo "Instalado em \${BIN_DIR} e atalho criado em \${APP_DIR}/edocbr-plenario-desktop.desktop."
echo ""
echo "Próximos passos (primeira vez):"
echo "  1. Salve a senha do cofre: echo 'SUA_SENHA' > \${DATA_DIR}/passphrase && chmod 600 \${DATA_DIR}/passphrase"
echo "  2. Inicialize: EDOCBR_LOCAL_PASSPHRASE=SUA_SENHA \${BIN_DIR}/edocbr-plenario-cli init \${DATA_DIR}/device <tenantId> https://edocbrplenario.com.br"
echo "  3. Pareie e confie na chave: enroll e trust"
echo "  4. Abra pelo menu de aplicativos ou rode: \${BIN_DIR}/edocbr-plenario-desktop --open"
`
  const installPath = join(outDir, 'install.sh')
  await writeFile(installPath, installSh, { mode: 0o755 })
  await chmod(installPath, 0o755)

  const readme = `edocBR Plenário Desktop — Pacote Standalone Linux x64
=====================================================

Conteúdo:
- edocbr-plenario-desktop : Servidor local LAN + interface desktop (6 telas) + /telao + /vereador
- edocbr-plenario-cli     : Ferramenta de pareamento e verificação (init, enroll, trust, sync, status)
- install.sh              : Instalador para ~/.local/bin e menu de aplicativos (.desktop)

Instalação rápida:
  ./install.sh
`
  await writeFile(join(outDir, 'README.txt'), readme, { mode: 0o644 })

  const tarball = join(outDir, 'edocbr-plenario-desktop-linux-x64.tar.gz')
  execFileSync(
    'tar',
    ['-czf', tarball, '-C', outDir, 'edocbr-plenario-desktop', 'edocbr-plenario-cli', 'install.sh', 'README.txt'],
    { stdio: 'inherit' }
  )

  console.log(JSON.stringify({ ok: true, outDir, desktopBin, cliBin, tarball }))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
