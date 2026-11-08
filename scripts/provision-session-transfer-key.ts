/** Offline operator command. Never prints or stores private key in the repository. */
import { resolve, sep } from 'node:path'
import { provisionTransferSigningKey } from '../src/lib/server/session-transfer-signing'

const tenantId = process.argv[2]
const root = process.env.EDOCBR_TRANSFER_KEY_ROOT
if (!tenantId || !root) {
  console.error('Uso: EDOCBR_TRANSFER_KEY_ROOT=/caminho/privado bun scripts/provision-session-transfer-key.ts <tenantId>')
  process.exit(2)
}
const absoluteRoot = resolve(root)
const repository = resolve(process.cwd())
if (absoluteRoot === repository || absoluteRoot.startsWith(repository + sep)) {
  console.error('O diretório de chaves deve ficar fora do repositório.')
  process.exit(2)
}
const { active, publicKeyPem } = await provisionTransferSigningKey({ root: absoluteRoot, tenantId })
console.log(JSON.stringify({ tenantId, keyId: active.keyId,
  publicKeySpkiSha256: active.publicKeySpkiSha256, publicKeyPem }, null, 2))
