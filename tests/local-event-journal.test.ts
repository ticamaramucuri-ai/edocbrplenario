import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalEventJournal } from '@/lib/local-event-journal'

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
