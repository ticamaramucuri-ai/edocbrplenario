import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { GET as getTallies, POST as tally } from '@/app/api/v1/votings/[id]/symbolic-tally/route'
import { POST as transition } from '@/app/api/v1/votings/[id]/transition/route'

afterAll(async () => { await db.$disconnect() })

test('votação simbólica oficial exige segunda identidade e fecha com a revisão confirmada', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `tally-${suffix}`, name: 'Câmara Teste', city: 'Teste', uf: 'BA',
    settings: JSON.stringify({ quorumMinimum: 1 }) } })
  const other = await db.tenant.create({ data: { slug: `tally-other-${suffix}`, name: 'Outra Câmara', city: 'Teste', uf: 'BA' } })
  const clerk = await db.user.create({ data: { tenantId: tenant.id, name: 'Secretaria', email: `clerk-${suffix}@example.invalid`, role: 'session_operator' } })
  const chair = await db.user.create({ data: { tenantId: tenant.id, name: 'Presidência', email: `chair-${suffix}@example.invalid`, role: 'presiding_officer' } })
  const outsider = await db.user.create({ data: { tenantId: other.id, name: 'Fora', email: `outside-${suffix}@example.invalid`, role: 'session_operator' } })
  const member = await db.parliamentarian.create({ data: { tenantId: tenant.id, name: 'Membro', party: 'SEM' } })
  const session = await db.session.create({ data: { tenantId: tenant.id, type: 'ordinaria', number: 1, year: 2037,
    scheduledAt: new Date('2037-01-01T12:00:00.000Z'), status: 'open', official: true } })
  await db.attendanceEvent.create({ data: { sessionId: session.id, parliamentarianId: member.id, kind: 'check_in', status: 'presente' } })
  const voting = await db.voting.create({ data: { sessionId: session.id, question: 'Aprovar?', mode: 'simbolico', status: 'open',
    rule: 'maioria_simples', requiredQuorum: 1, quorumAtOpen: 1, memberBaseAtOpen: 1, presentAtOpen: 1,
    eligibleVoterIdsAtOpen: JSON.stringify([member.id]), version: 2 } })
  const url = `http://localhost/api/v1/votings/${voting.id}`
  const ctx = { params: Promise.resolve({ id: voting.id }) }
  const request = (actorId: string, path: string, body: unknown) => new NextRequest(`${url}/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': actorId }, body: JSON.stringify(body) })
  const postTally = (actorId: string, body: unknown) => tally(request(actorId, 'symbolic-tally', body), ctx)
  const close = (actorId: string, body: unknown) => transition(request(actorId, 'transition', body), ctx)
  expect((await close(clerk.id, { action: 'close', version: 2, sim: 1, nao: 0, abstencoes: 0 })).status).toBe(409)
  expect((await postTally(outsider.id, { action: 'propose', version: 2, sim: 1, nao: 0, abstencoes: 0 })).status).toBe(403)
  const proposal = await postTally(clerk.id, { action: 'propose', version: 2, sim: 1, nao: 0, abstencoes: 0 })
  expect(proposal.status).toBe(200)
  const proposed = await proposal.json()
  expect(proposed.version).toBe(3)
  expect((await close(clerk.id, { action: 'close', version: 3 })).status).toBe(409)
  expect((await postTally(clerk.id, { action: 'confirm', version: 3, revisionId: proposed.revision.id })).status).toBe(403)
  const confirmed = await postTally(chair.id, { action: 'confirm', version: 3, revisionId: proposed.revision.id })
  expect(confirmed.status).toBe(200)
  expect((await confirmed.json()).version).toBe(4)
  expect((await postTally(clerk.id, { action: 'propose', version: 4, sim: 0, nao: 1, abstencoes: 0 })).status).toBe(409)
  expect((await close(clerk.id, { action: 'close', version: 4, sim: 0, nao: 1, abstencoes: 0 })).status).toBe(422)
  expect((await close(clerk.id, { action: 'close', version: 4 })).status).toBe(200)
  const final = await db.voting.findUniqueOrThrow({ where: { id: voting.id } })
  expect(final.resultStatus).toBe('aprovado')
  expect(JSON.parse(final.resultCounts ?? '{}').sim).toBe(1)
  const listed = await getTallies(new NextRequest(`${url}/symbolic-tally`, { headers: { 'x-actor-id': chair.id } }), ctx)
  expect((await listed.json()).revisions[0].confirmedByName).toBe('Presidência')
  expect(await db.symbolicTallyRevision.count({ where: { votingId: voting.id } })).toBe(1)
})
