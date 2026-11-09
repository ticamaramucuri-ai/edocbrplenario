/** Read a systemd-delivered credential without placing the secret in argv or environment. */
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

const MAX_CREDENTIAL_BYTES = 4096

export async function readLocalServiceCredential(path: string): Promise<string> {
  if (process.platform !== 'linux') throw new Error('Credencial de serviço disponível apenas no Linux nesta etapa.')
  if (!isAbsolute(path) || resolve(path) !== path || await realpath(path) !== path) {
    throw new Error('Caminho da credencial de serviço inválido ou redirecionado.')
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    const uid = process.getuid?.()
    if (!info.isFile() || info.size > MAX_CREDENTIAL_BYTES || (info.mode & 0o077) ||
        uid === undefined || info.uid !== uid) {
      throw new Error('Arquivo de credencial de serviço inseguro.')
    }
    const value = (await handle.readFile('utf8')).replace(/\r?\n$/, '')
    if (Buffer.byteLength(value) > MAX_CREDENTIAL_BYTES || value.length < 20) {
      throw new Error('Credencial de serviço inválida.')
    }
    return value
  } finally { await handle.close() }
}
