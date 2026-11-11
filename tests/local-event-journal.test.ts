import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalEventJournal } from '@/lib/local-event-journal'
import { signSessionAuthorityGrant } from '@/lib/session-authority-contract'

test('diário local persiste sequência, deduplica comando e rejeita escopo ou payload alterado', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edocbr-journal-'))
  const key = generateKeyPairSync('ed25519')
  const args = { root, tenantId: 'camara-a', deviceId: 'desktop-a', privateKey: key.privateKey }
  try {
    const journal = openLocalEventJournal(args)
    const first = journal.append({ sessionId: 'sessao-1', commandId: 'comando-1',
      expectedSequence: 0, eventType: 'presence.recorded', actorId: 'operador-1',
      payload: { present: true, parliamentarianId: 'vereador-1' } })
    expect(first.sequence).toBe(1)
    expect(first.previousHash).toBe('0'.repeat(64))
    const secondConnection = openLocalEventJournal(args)
    expect(secondConnection.append({ sessionId: 'sessao-1', commandId: 'comando-1',
      expectedSequence: 0, eventType: 'presence.recorded', actorId: 'operador-1',
      payload: { parliamentarianId: 'vereador-1', present: true } })).toEqual(first)
    expect(() => secondConnection.append({ sessionId: 'sessao-1', commandId: 'comando-2',
      expectedSequence: 0, eventType: 'presence.recorded', actorId: 'operador-1',
      payload: { present: false } })).toThrow('Sequência')
    secondConnection.close()
    expect(journal.append({ sessionId: 'sessao-1', commandId: 'comando-1',
      expectedSequence: 0, eventType: 'presence.recorded', actorId: 'operador-1',
      payload: { parliamentarianId: 'vereador-1', present: true } })).toEqual(first)
    expect(() => journal.append({ sessionId: 'sessao-1', commandId: 'comando-1',
      expectedSequence: 1, eventType: 'presence.recorded', actorId: 'operador-1',
      payload: { present: false } })).toThrow('reutilizado')
    expect(() => journal.append({ sessionId: 'sessao-1', commandId: 'comando-2',
      expectedSequence: 0, eventType: 'presence.recorded', actorId: 'operador-1',
      payload: { present: true } })).toThrow('Sequência')
    const second = journal.append({ sessionId: 'sessao-1', commandId: 'comando-2',
      expectedSequence: 1, eventType: 'presence.recorded', actorId: 'operador-1',
      payload: { present: false, parliamentarianId: 'vereador-1' } })
    expect(second.previousHash).toBe(first.eventHash)
    expect(journal.list('sessao-1', 1)).toEqual([second])
    journal.close()

    const reopened = openLocalEventJournal(args)
    expect(reopened.list('sessao-1')).toEqual([first, second])
    reopened.close()
    expect(() => openLocalEventJournal({ ...args, tenantId: 'camara-b' })).toThrow('outra Câmara')
    expect(() => openLocalEventJournal({ ...args, privateKey: generateKeyPairSync('ed25519').privateKey }))
      .toThrow('outra Câmara')

    const tamper = new Database(join(root, 'events.sqlite'))
    tamper.query('UPDATE local_events SET payload_json = ? WHERE session_id = ? AND sequence = 1')
      .run('{"present":false}', 'sessao-1')
    tamper.close()
    expect(() => openLocalEventJournal(args)).toThrow('Cadeia ou assinatura')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('escrita é bloqueada quando o último evento muda enquanto o processo está ativo', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edocbr-journal-'))
  const key = generateKeyPairSync('ed25519')
  const journal = openLocalEventJournal({ root, tenantId: 'camara-a', deviceId: 'desktop-a', privateKey: key.privateKey })
  try {
    journal.append({ sessionId: 'sessao-1', commandId: 'comando-1', expectedSequence: 0,
      eventType: 'presence.recorded', actorId: 'operador-1', payload: { present: true } })
    const tamper = new Database(join(root, 'events.sqlite'))
    tamper.query('UPDATE local_events SET payload_json = ? WHERE session_id = ? AND sequence = 1')
      .run('{"present":false}', 'sessao-1')
    tamper.close()
    expect(() => journal.append({ sessionId: 'sessao-1', commandId: 'comando-2', expectedSequence: 1,
      eventType: 'presence.recorded', actorId: 'operador-1', payload: { present: false } }))
      .toThrow('Último evento')
  } finally { journal.close(); await rm(root, { recursive: true, force: true }) }
})

test('desktop persiste a maior época assinada e rejeita concessão antiga após reinício', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edocbr-journal-'))
  const deviceKey = generateKeyPairSync('ed25519')
  const saasKey = generateKeyPairSync('ed25519')
  const journalArgs = { root, tenantId: 'camara-a', deviceId: 'desktop-a', privateKey: deviceKey.privateKey }
  const context = { sessionId: 'sessao-1', revisionId: 'revisao-3',
    manifestSha256: 'a'.repeat(64), trustedKeys: new Map([['saas-1', saasKey.publicKey]]),
    now: new Date('2026-11-11T12:00:00Z') }
  const signed = (epoch: number, expiresAt = '2026-11-11T12:10:00Z') =>
    signSessionAuthorityGrant({ format: 'edocbr.session-authority', schemaVersion: 1,
      tenantId: 'camara-a', sessionId: 'sessao-1', deviceId: 'desktop-a',
      revisionId: 'revisao-3', manifestSha256: 'a'.repeat(64), epoch,
      issuedAt: '2026-11-11T11:59:00Z', notBefore: '2026-11-11T12:00:00Z',
      expiresAt }, 'saas-1', saasKey.privateKey)
  try {
    const journal = openLocalEventJournal(journalArgs)
    expect(journal.acceptAuthorityGrant({ ...context, signed: signed(7) }).epoch).toBe(7)
    journal.close()

    const reopened = openLocalEventJournal(journalArgs)
    expect(reopened.acceptAuthorityGrant({ ...context, signed: signed(7) }).epoch).toBe(7)
    expect(() => reopened.acceptAuthorityGrant({ ...context, signed: signed(6) })).toThrow('obsoleta')
    expect(() => reopened.acceptAuthorityGrant({ ...context,
      signed: signed(7, '2026-11-11T12:09:00Z') })).toThrow('diverge')
    expect(reopened.acceptAuthorityGrant({ ...context, signed: signed(8) }).epoch).toBe(8)
    expect(() => reopened.acceptAuthorityGrant({ ...context, signed: signed(7) })).toThrow('obsoleta')
    expect(() => reopened.acceptAuthorityGrant({ ...context, signed: {
      ...signed(9), grant: { ...signed(9).grant, deviceId: 'desktop-b' },
    } })).toThrow('Assinatura')
    reopened.close()

    const tamper = new Database(join(root, 'events.sqlite'))
    tamper.query('UPDATE authority_epoch SET signed_grant_hash = ? WHERE session_id = ?')
      .run('b'.repeat(64), 'sessao-1')
    tamper.close()
    expect(() => openLocalEventJournal(journalArgs)).toThrow('adulterada')
  } finally { await rm(root, { recursive: true, force: true }) }
})
