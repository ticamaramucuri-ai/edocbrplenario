import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { mkdtemp, mkdir, copyFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { db } from '@/lib/db'
import { POST as archivePost, GET as archiveGet } from '@/app/api/v1/sessions/[id]/transmission/archive/route'
import { GET as replayGet } from '@/app/api/v1/public/sessions/[id]/replay/route'
import { GET as publicSessionGet } from '@/app/api/v1/public/sessions/[id]/route'

const oldSource = process.env.MEDIA_RECORDINGS_ROOT
const oldReplay = process.env.MEDIA_REPLAY_ROOT
let workdir: string | undefined

afterAll(async () => {
  if (oldSource === undefined) delete process.env.MEDIA_RECORDINGS_ROOT
  else process.env.MEDIA_RECORDINGS_ROOT = oldSource
  if (oldReplay === undefined) delete process.env.MEDIA_REPLAY_ROOT
  else process.env.MEDIA_REPLAY_ROOT = oldReplay
  if (workdir) await rm(workdir, { recursive: true, force: true })
  await db.$disconnect()
})

test('manifesto, publicação, range, isolamento e adulteração do replay', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `record-${suffix}`, name: 'Câmara de teste', city: 'Teste', uf: 'BA', settings: JSON.stringify({ replayVisibilityDays: 2 }) } })
  const other = await db.tenant.create({ data: { slug: `other-${suffix}`, name: 'Outra Câmara', city: 'Teste', uf: 'BA' } })
  const operator = await db.user.create({ data: { tenantId: tenant.id, name: 'Operador', email: `record-${suffix}@example.invalid`, role: 'media_operator' } })
  const otherOperator = await db.user.create({ data: { tenantId: other.id, name: 'Outro', email: `record-other-${suffix}@example.invalid`, role: 'media_operator' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2026, status: 'closed', scheduledAt: new Date(), closedAt: new Date() } })
  await db.transmission.create({ data: { tenantId: tenant.id, sessionId: session.id, status: 'ended' } })
  workdir = await mkdtemp(join(tmpdir(), 'edocbr-recording-'))
  const sourceRoot = join(workdir, 'source')
  const replayRoot = join(workdir, 'replays')
  const sessionDir = join(sourceRoot, `session-${session.id}`)
  await mkdir(sessionDir, { recursive: true, mode: 0o700 })
  await mkdir(replayRoot, { mode: 0o700 })
  process.env.MEDIA_RECORDINGS_ROOT = sourceRoot
  process.env.MEDIA_REPLAY_ROOT = replayRoot
  const file1 = join(sessionDir, '2026-10-11_12-00-00-000000.mp4')
  const file2 = join(sessionDir, '2026-10-11_12-00-01-000000.mp4')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=800:sample_rate=48000', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-y', file1], { timeout: 15000 })
  await copyFile(file1, file2)
  const command = (actorId: string, action: 'build' | 'publish' | 'withdraw', version: number, idempotencyKey = crypto.randomUUID()) => archivePost(new NextRequest(`http://localhost/api/v1/sessions/${session.id}/transmission/archive`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': actorId }, body: JSON.stringify({ action, version, idempotencyKey }) }), { params: Promise.resolve({ id: session.id }) })
  const publicUrl = (slug = tenant.slug, range?: string) => replayGet(new NextRequest(`http://localhost/api/v1/public/sessions/${session.id}/replay?tenant=${slug}`, { headers: range ? { range } : undefined }), { params: Promise.resolve({ id: session.id }) })
  expect((await command(otherOperator.id, 'build', 1)).status).toBe(403)
  const before = await publicUrl()
  expect(before.status).toBe(404)
  const built = await command(operator.id, 'build', 1)
  expect(built.status).toBe(200)
  const body = await built.json()
  expect(body.recording).toMatchObject({ status: 'verified', segmentCount: 2, gapCount: 0 })
  const verify = await archiveGet(new NextRequest(`http://localhost/api/v1/sessions/${session.id}/transmission/archive?verify=1`, { headers: { 'x-actor-id': operator.id } }), { params: Promise.resolve({ id: session.id }) })
  expect((await verify.json()).integrity).toBe('valid')
  await writeFile(file2, 'segmento alterado')
  expect((await command(operator.id, 'publish', 1)).status).toBe(409)
  await copyFile(file1, file2)
  expect((await command(operator.id, 'publish', 1)).status).toBe(200)
  const detail = await publicSessionGet(new NextRequest(`http://localhost/api/v1/public/sessions/${session.id}?tenant=${tenant.slug}`), { params: Promise.resolve({ id: session.id }) })
  expect((await detail.json()).localReplay.durationSeconds).toBeGreaterThan(1)
  expect((await publicUrl(other.slug)).status).toBe(404)
  const replay = await publicUrl(tenant.slug, 'bytes=0-15')
  expect(replay.status).toBe(206)
  expect(replay.headers.get('content-range')).toMatch(/^bytes 0-15\//)
  expect((await replay.arrayBuffer()).byteLength).toBe(16)
  expect((await publicUrl(tenant.slug, 'bytes=999999999-')).status).toBe(416)
  const row = await db.sessionRecording.findUniqueOrThrow({ where: { sessionId: session.id } })
  expect(row.expiresAt?.getTime()).toBeGreaterThan(Date.now() + 86400000)
  const replayPath = join(replayRoot, tenant.id, session.id, 'replay.mp4')
  const restoredCopy = join(workdir, 'replay-backup.mp4')
  await copyFile(replayPath, restoredCopy)
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'json', replayPath], { encoding: 'utf8' })) as { streams: Array<{ codec_name: string }> }
  expect(probe.streams.map((stream) => stream.codec_name).sort()).toEqual(['aac', 'h264'])
  await writeFile(replayPath, 'alterado')
  expect((await publicUrl()).status).toBe(409)
  const verificationAfterTamper = await archiveGet(new NextRequest(`http://localhost/api/v1/sessions/${session.id}/transmission/archive?verify=1`, { headers: { 'x-actor-id': operator.id } }), { params: Promise.resolve({ id: session.id }) })
  expect((await verificationAfterTamper.json()).integrity).toBe('invalid')
  await copyFile(restoredCopy, replayPath)
  expect((await publicUrl(tenant.slug, 'bytes=0-15')).status).toBe(206)
  expect((await command(operator.id, 'withdraw', 2)).status).toBe(200)
  expect((await publicUrl()).status).toBe(404)
  const audit = await db.auditEvent.findMany({ where: { aggregateType: 'session_recording' } })
  expect(audit.map((item) => item.action)).toEqual(['recording.build', 'recording.publish', 'recording.withdraw'])
})
