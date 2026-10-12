import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as createVoting } from '@/app/api/v1/sessions/[id]/votings/route'
import { POST as transitionVoting } from '@/app/api/v1/votings/[id]/transition/route'
import { POST as castVote } from '@/app/api/v1/votings/[id]/votes/route'
import { POST as createPublication } from '@/app/api/v1/publications/route'
import { GET as getPublication, PATCH as patchPublication } from '@/app/api/v1/publications/[id]/route'
import { GET as publicAta } from '@/app/api/v1/public/documents/ata/[sessionId]/route'
import { GET as publicSession } from '@/app/api/v1/public/sessions/[id]/route'
import { GET as verifyPublication } from '@/app/api/v1/public/verify/route'
import { POST as signAta } from '@/app/api/v1/me/ata/sign/route'

afterAll(async () => { await db.$disconnect() })
const post = (url: string, actorId: string, body: unknown) => new NextRequest(url, { method: 'POST',
  headers: { 'content-type': 'application/json', 'x-actor-id': actorId }, body: JSON.stringify(body) })
const patch = (url: string, actorId: string, body: unknown) => new NextRequest(url, { method: 'PATCH',
  headers: { 'content-type': 'application/json', 'x-actor-id': actorId }, body: JSON.stringify(body) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

test('voto secreto oficial é bloqueado na criação e nas rotas legadas de abertura e voto', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `secret-${suffix}`, name: 'Teste', city: 'Teste', uf: 'BA' } })
  const actor = await db.user.create({ data: { tenantId: tenant.id, name: 'Mesa', email: `mesa-${suffix}@example.invalid`, role: 'session_operator' } })
  const member = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Membro', party: 'SEM' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2038,
    scheduledAt: new Date('2038-01-01T12:00:00.000Z'), status: 'open', official: true } })
  const url = `http://localhost/api/v1/sessions/${session.id}/votings`
  expect((await createVoting(post(url, actor.id, { mode: 'secreto', question: 'Questão oficial?' }), ctx(session.id))).status).toBe(409)
  const legacy = await db.voting.create({ data: { sessionId: session.id, question: 'Legado', mode: 'secreto', status: 'ready' } })
  expect((await transitionVoting(post(`http://localhost/api/v1/votings/${legacy.id}/transition`, actor.id,
    { action: 'open', version: 1 }), ctx(legacy.id))).status).toBe(409)
  await db.voting.update({ where: { id: legacy.id }, data: { status: 'open' } })
  await db.attendanceEvent.create({ data: { sessionId: session.id, parliamentarianId: member.id, kind: 'check_in', status: 'presente' } })
  expect((await castVote(post(`http://localhost/api/v1/votings/${legacy.id}/votes`, actor.id,
    { parliamentarianId: member.id, value: 'sim', commandId: crypto.randomUUID() }), ctx(legacy.id))).status).toBe(409)
  expect(await db.vote.count({ where: { votingId: legacy.id } })).toBe(0)
})

test('ata revisada exige outra pessoa para publicar; hash, vínculo público e revogação são verificáveis', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `ata-${suffix}`, name: 'Câmara Ata', city: 'Teste', uf: 'BA' } })
  const other = await db.tenant.create({ data: { slug: `ata-other-${suffix}`, name: 'Outra', city: 'Teste', uf: 'BA' } })
  const reviewer = await db.user.create({ data: { tenantId: tenant.id, name: 'Revisor', email: `review-${suffix}@example.invalid`, role: 'legislative_admin' } })
  const publisher = await db.user.create({ data: { tenantId: tenant.id, name: 'Publicador', email: `publish-${suffix}@example.invalid`, role: 'tenant_admin' } })
  const member = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Vereador', party: 'SEM' } })
  const signer = await db.user.create({ data: { tenantId: tenant.id, parliamentarianId: member.id,
    name: 'Vereador', email: `signer-${suffix}@example.invalid`, role: 'parliamentarian' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, number: 1, year: 2039,
    scheduledAt: new Date('2039-01-01T12:00:00.000Z'), status: 'closed', official: true, closedAt: new Date('2039-01-01T15:00:00.000Z') } })
  const foreign = await db.session.create({ data: { tenantId: other.id, number: 1, year: 2039,
    scheduledAt: new Date('2039-01-01T12:00:00.000Z'), status: 'closed' } })
  await db.attendanceEvent.create({ data: { sessionId: session.id, parliamentarianId: member.id, kind: 'check_in', status: 'presente' } })
  const pubUrl = 'http://localhost/api/v1/publications'
  expect((await createPublication(post(pubUrl, publisher.id, { kind: 'ata_sessao', title: 'Ata sem vínculo', contentMd: 'Texto completo da sessão.' }),
    { params: Promise.resolve({}) })).status).toBe(422)
  expect((await createPublication(post(pubUrl, publisher.id, { kind: 'ata_sessao', title: 'Ata de outra Câmara',
    contentMd: 'Texto completo da sessão.', sessionId: foreign.id }), { params: Promise.resolve({}) })).status).toBe(403)
  const create = await createPublication(post(pubUrl, publisher.id, { kind: 'ata_sessao', title: 'Ata da Sessão Ordinária',
    contentMd: 'Texto completo conferido da sessão e suas deliberações.', sessionId: session.id }), { params: Promise.resolve({}) })
  expect(create.status).toBe(201)
  const id = (await create.json()).publication.id as string
  const url = `${pubUrl}/${id}`
  const detail = await getPublication(new NextRequest(url, { headers: { 'x-actor-id': reviewer.id } }), ctx(id))
  const hash = (await detail.json()).publication.currentReviewHash as string
  expect((await patchPublication(patch(url, publisher.id, { action: 'publish' }), ctx(id))).status).toBe(409)
  expect((await patchPublication(patch(url, reviewer.id, { action: 'review', expectedHash: '0'.repeat(64), reference: 'Conferência 001' }), ctx(id))).status).toBe(409)
  expect((await patchPublication(patch(url, reviewer.id, { action: 'review', expectedHash: hash, reference: 'Conferência 001' }), ctx(id))).status).toBe(200)
  expect((await patchPublication(patch(url, publisher.id, { action: 'edit', title: 'Ata da Sessão Ordinária revisada' }), ctx(id))).status).toBe(200)
  expect((await patchPublication(patch(url, publisher.id, { action: 'publish' }), ctx(id))).status).toBe(409)
  const revisedDetail = await getPublication(new NextRequest(url, { headers: { 'x-actor-id': reviewer.id } }), ctx(id))
  const revisedHash = (await revisedDetail.json()).publication.currentReviewHash as string
  expect(revisedHash).not.toBe(hash)
  expect((await patchPublication(patch(url, reviewer.id, { action: 'review', expectedHash: revisedHash, reference: 'Conferência 002' }), ctx(id))).status).toBe(200)
  expect((await patchPublication(patch(url, reviewer.id, { action: 'publish' }), ctx(id))).status).toBe(403)
  expect((await patchPublication(patch(url, publisher.id, { action: 'publish' }), ctx(id))).status).toBe(200)
  const duplicate = await createPublication(post(pubUrl, publisher.id, { kind: 'ata_sessao', title: 'Ata duplicada',
    contentMd: 'Outra versão do mesmo texto, ainda sem retificação formal.', sessionId: session.id }), { params: Promise.resolve({}) })
  expect(duplicate.status).toBe(201)
  const duplicateId = (await duplicate.json()).publication.id as string
  const duplicateUrl = `${pubUrl}/${duplicateId}`
  const duplicateDetail = await getPublication(new NextRequest(duplicateUrl, { headers: { 'x-actor-id': reviewer.id } }), ctx(duplicateId))
  const duplicateHash = (await duplicateDetail.json()).publication.currentReviewHash as string
  expect((await patchPublication(patch(duplicateUrl, reviewer.id, { action: 'review', expectedHash: duplicateHash, reference: 'Conferência duplicada' }), ctx(duplicateId))).status).toBe(200)
  await db.publication.update({ where: { id }, data: { activeAtaSessionKey: null } }) // registro publicado antes da migração
  expect((await patchPublication(patch(duplicateUrl, publisher.id, { action: 'publish' }), ctx(duplicateId))).status).toBe(409)
  await db.publication.update({ where: { id }, data: { activeAtaSessionKey: session.id } })
  const publicUrl = `http://localhost/api/v1/public/documents/ata/${session.id}?tenant=${tenant.slug}`
  const publicResponse = await publicAta(new NextRequest(publicUrl), { params: Promise.resolve({ sessionId: session.id }) })
  expect(publicResponse.status).toBe(200)
  const publicView = await publicResponse.json()
  expect(publicView.contentSha256Valid).toBe(true)
  expect(publicView.chainValid).toBe(true)
  expect(publicView.docHash).toHaveLength(64)
  const verifyUrl = `http://localhost/api/v1/public/verify?code=${publicView.verificationCode}`
  expect((await (await verifyPublication(new NextRequest(verifyUrl), { params: Promise.resolve({}) })).json()).status).toBe('valida')
  const sessionResponse = await publicSession(new NextRequest(`http://localhost/api/v1/public/sessions/${session.id}?tenant=${tenant.slug}`), ctx(session.id))
  expect((await sessionResponse.json()).ata.publicationId).toBe(id)
  expect((await signAta(post('http://localhost/api/v1/me/ata/sign', signer.id, {}), { params: Promise.resolve({}) })).status).toBe(200)
  await db.publication.update({ where: { id }, data: { contentMd: 'Conteúdo adulterado.' } })
  const tampered = await publicAta(new NextRequest(publicUrl), { params: Promise.resolve({ sessionId: session.id }) })
  expect((await tampered.json()).chainValid).toBe(false)
  expect((await (await verifyPublication(new NextRequest(verifyUrl), { params: Promise.resolve({}) })).json()).status).toBe('integridade_invalida')
  expect((await patchPublication(patch(url, publisher.id, { action: 'revoke', reason: 'Correção formal da ata publicada' }), ctx(id))).status).toBe(200)
  expect((await publicAta(new NextRequest(publicUrl), { params: Promise.resolve({ sessionId: session.id }) })).status).toBe(404)
  const correction = await createPublication(post(pubUrl, publisher.id, { kind: 'ata_sessao', title: 'Ata retificada da Sessão Ordinária',
    contentMd: 'Texto corrigido, aprovado na conferência documental.', sessionId: session.id }), { params: Promise.resolve({}) })
  expect(correction.status).toBe(201)
  const correctionId = (await correction.json()).publication.id as string
  const correctionUrl = `${pubUrl}/${correctionId}`
  const correctionDetail = await getPublication(new NextRequest(correctionUrl, { headers: { 'x-actor-id': reviewer.id } }), ctx(correctionId))
  const correctionHash = (await correctionDetail.json()).publication.currentReviewHash as string
  expect((await patchPublication(patch(correctionUrl, reviewer.id, { action: 'review', expectedHash: correctionHash, reference: 'Retificação 003' }), ctx(correctionId))).status).toBe(200)
  expect((await patchPublication(patch(correctionUrl, publisher.id, { action: 'publish' }), ctx(correctionId))).status).toBe(200)
  const corrected = await publicAta(new NextRequest(publicUrl), { params: Promise.resolve({ sessionId: session.id }) })
  expect((await corrected.json()).publicationId).toBe(correctionId)
})
