/** Arquivo de mídia local: caminhos derivados da sessão, nunca de entrada HTTP. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, lstat, mkdir, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { DomainError } from './errors'

const run = promisify(execFile)
const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/
const MAX_SEGMENTS = 10000
const MAX_GAP_SECONDS = 1.5

export type RecordingSegment = { name: string; bytes: number; sha256: string; durationSeconds: number; startedAt: string; codecs: string[] }
export type RecordingManifest = { format: 1; sessionId: string; segments: RecordingSegment[]; totalDurationSeconds: number; gapCount: number }

function invalid(detail: string): DomainError {
  return new DomainError('MEDIA_ARCHIVE_INVALID', 409, 'Gravação inválida', detail)
}

export function safeRecordingId(id: string): string {
  if (!SAFE_ID.test(id)) throw invalid('Identificador de sessão ou Câmara inválido.')
  return id
}

async function checkedRoot(name: 'MEDIA_RECORDINGS_ROOT' | 'MEDIA_REPLAY_ROOT'): Promise<string> {
  const value = process.env[name]?.trim()
  if (!value || !isAbsolute(value) || /[\r\n]/.test(value)) throw new DomainError('MEDIA_ARCHIVE_UNAVAILABLE', 503, 'Arquivo indisponível', `Configure ${name} com um diretório absoluto privado.`)
  try {
    const info = await lstat(value)
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o007) !== 0) throw new Error('unsafe root')
    return await realpath(value)
  } catch { throw new DomainError('MEDIA_ARCHIVE_UNAVAILABLE', 503, 'Arquivo indisponível', `${name} deve existir e não permitir acesso público.`) }
}

export async function sourceRecordingDir(sessionId: string): Promise<string> {
  const root = await checkedRoot('MEDIA_RECORDINGS_ROOT')
  const path = join(root, `session-${safeRecordingId(sessionId)}`)
  const info = await lstat(path).catch(() => null)
  if (!info?.isDirectory() || info.isSymbolicLink()) throw invalid('Não há segmentos no caminho da sessão.')
  return path
}

export async function replayFilePath(tenantId: string, sessionId: string, create = false): Promise<string> {
  const root = await checkedRoot('MEDIA_REPLAY_ROOT')
  const tenantDir = join(root, safeRecordingId(tenantId))
  const dir = join(tenantDir, safeRecordingId(sessionId))
  if (create) {
    await mkdir(tenantDir, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
    await mkdir(dir, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
  }
  const tenantInfo = await lstat(tenantDir).catch(() => null)
  if (!tenantInfo?.isDirectory() || tenantInfo.isSymbolicLink() || (tenantInfo.mode & 0o007) !== 0) throw invalid('Diretório da Câmara inseguro.')
  const info = await lstat(dir).catch(() => null)
  if (!info?.isDirectory() || info.isSymbolicLink() || (info.mode & 0o007) !== 0) throw invalid('Diretório de replay inseguro.')
  return join(dir, 'replay.mp4')
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function startFromName(name: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(\d{6})\.mp4$/.exec(name)
  if (!match) throw invalid(`Nome de segmento inválido: ${name}.`)
  const [, year, month, day, hour, minute, second, micros] = match
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${micros.slice(0, 3)}Z`
}

async function inspectSegment(path: string, name: string): Promise<RecordingSegment> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) throw invalid(`Segmento inválido: ${name}.`)
  let probe: { format?: { duration?: string }; streams?: Array<{ codec_name?: string }> }
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name', '-of', 'json', path], { timeout: 15_000, maxBuffer: 128_000 })
    probe = JSON.parse(stdout)
  } catch { throw invalid(`Não foi possível inspecionar ${name}.`) }
  const duration = Number(probe.format?.duration)
  const codecs = (probe.streams ?? []).map((stream) => stream.codec_name ?? '')
  if (!Number.isFinite(duration) || duration <= 0 || !codecs.includes('h264') || !codecs.includes('aac')) throw invalid(`Vídeo H.264 e áudio AAC são obrigatórios em ${name}.`)
  return { name, bytes: info.size, sha256: await sha256File(path), durationSeconds: duration, startedAt: startFromName(name), codecs }
}

export async function inspectRecording(sessionId: string): Promise<{ manifest: RecordingManifest; directory: string }> {
  const directory = await sourceRecordingDir(sessionId)
  const names = (await readdir(directory)).filter((name) => name.endsWith('.mp4')).sort()
  if (!names.length || names.length > MAX_SEGMENTS) throw invalid('Quantidade de segmentos inválida.')
  const segments: RecordingSegment[] = []
  for (const name of names) segments.push(await inspectSegment(join(directory, name), name))
  let gapCount = 0
  for (let i = 1; i < segments.length; i += 1) {
    const previous = segments[i - 1]
    const delta = (Date.parse(segments[i].startedAt) - Date.parse(previous.startedAt)) / 1000
    if (!Number.isFinite(delta) || delta < 0) throw invalid('Ordem temporal dos segmentos inválida.')
    if (delta > previous.durationSeconds + MAX_GAP_SECONDS) gapCount += 1
  }
  return { directory, manifest: { format: 1, sessionId, segments, totalDurationSeconds: segments.reduce((sum, item) => sum + item.durationSeconds, 0), gapCount } }
}

export async function verifySourceManifest(sessionId: string, storedJson: string, storedSha256: string): Promise<void> {
  if (createHash('sha256').update(storedJson).digest('hex') !== storedSha256) throw new DomainError('MEDIA_ARCHIVE_TAMPERED', 409, 'Manifesto alterado', 'O manifesto não corresponde ao hash registrado.')
  const current = (await inspectRecording(sessionId)).manifest
  const stored = JSON.parse(storedJson) as RecordingManifest
  if (current.segments.length !== stored.segments.length || current.segments.some((item, index) => item.name !== stored.segments[index].name || item.sha256 !== stored.segments[index].sha256)) {
    throw new DomainError('MEDIA_ARCHIVE_TAMPERED', 409, 'Segmento alterado', 'Os segmentos não correspondem ao manifesto registrado.')
  }
}

/** Produz derivado atômico em diretório privado e confere entrada novamente. */
export async function buildRecordingArchive(tenantId: string, sessionId: string): Promise<{ manifest: RecordingManifest; manifestSha256: string; replaySha256: string; replayBytes: bigint; durationSeconds: number; gapCount: number }> {
  const target = await replayFilePath(tenantId, sessionId, true)
  const lock = `${target}.lock`
  try { await mkdir(lock, { mode: 0o700 }) }
  catch { throw new DomainError('MEDIA_PATH_BUSY', 503, 'Arquivo em preparação', 'Outro processo está preparando o replay desta sessão.') }
  try { return await buildLocked(sessionId, target) }
  finally { await rm(lock, { recursive: true, force: true }) }
}

async function buildLocked(sessionId: string, target: string) {
  const { directory, manifest } = await inspectRecording(sessionId)
  const temp = `${target}.${randomUUID()}.tmp.mp4`
  const list = `${target}.${randomUUID()}.concat.txt`
  const content = manifest.segments.map((item) => `file '${join(directory, item.name).replace(/'/g, "'\\''")}'`).join('\n') + '\n'
  try {
    await writeFile(list, content, { mode: 0o600, flag: 'wx' })
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', '-y', temp], { timeout: 900_000, maxBuffer: 128_000 })
    await chmod(temp, 0o600)
    const output = await lstat(temp)
    if (!output.isFile() || output.size <= 0) throw invalid('Replay não foi produzido.')
    const replaySha256 = await sha256File(temp)
    // Uma alteração no original durante a concatenação impede publicar um derivado inconsistente.
    for (const item of manifest.segments) {
      if (await sha256File(join(directory, item.name)) !== item.sha256) throw invalid('Segmento alterado durante a preparação do replay.')
    }
    await rename(temp, target)
    const manifestJson = JSON.stringify(manifest)
    return { manifest, manifestSha256: createHash('sha256').update(manifestJson).digest('hex'), replaySha256, replayBytes: BigInt(output.size), durationSeconds: manifest.totalDurationSeconds, gapCount: manifest.gapCount }
  } catch (error) {
    if (error instanceof DomainError) throw error
    throw invalid('Não foi possível gerar o replay a partir dos segmentos. Confira o FFmpeg e os arquivos de origem.')
  } finally {
    await rm(list, { force: true }).catch(() => undefined)
    await rm(temp, { force: true }).catch(() => undefined)
  }
}

export async function verifyReplayFile(tenantId: string, sessionId: string, expectedBytes: bigint, expectedSha256: string): Promise<string> {
  const path = await replayFilePath(tenantId, sessionId)
  const info = await lstat(path).catch(() => null)
  if (!info?.isFile() || info.isSymbolicLink() || BigInt(info.size) !== expectedBytes || await sha256File(path) !== expectedSha256) {
    throw new DomainError('MEDIA_ARCHIVE_TAMPERED', 409, 'Replay alterado', 'O arquivo não corresponde ao manifesto verificado.')
  }
  return path
}
