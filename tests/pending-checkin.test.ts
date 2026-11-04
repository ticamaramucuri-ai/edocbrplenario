import { expect, test } from 'bun:test'
import { clearPendingCheckIn, pendingCheckInCommand } from '@/lib/pending-checkin'

function storage() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

test('reutiliza tentativa após remount e isola parlamentar, sessão e conclusão', () => {
  const store = storage()
  const first = pendingCheckInCommand(store, 'ator-a', 'sessao-1')
  expect(pendingCheckInCommand(store, 'ator-a', 'sessao-1')).toBe(first)
  expect(pendingCheckInCommand(store, 'ator-b', 'sessao-1')).not.toBe(first)
  clearPendingCheckIn(store, 'ator-a', 'outra-sessao')
  expect(pendingCheckInCommand(store, 'ator-a', 'sessao-1')).toBe(first)
  clearPendingCheckIn(store, 'ator-a', 'sessao-1')
  expect(pendingCheckInCommand(store, 'ator-a', 'sessao-1')).not.toBe(first)
  expect(pendingCheckInCommand(store, 'ator-a', 'sessao-2')).not.toBe(first)
})

test('descarta chave local inválida ou corrompida', () => {
  const store = storage()
  store.setItem('edocbr:pending-checkin:ator-a', '{')
  const fresh = pendingCheckInCommand(store, 'ator-a', 'sessao-1')
  expect(fresh).toMatch(/^[0-9a-f-]{36}$/)
  store.setItem('edocbr:pending-checkin:ator-a', JSON.stringify({ sessionId: 'sessao-1', commandId: 'invalida' }))
  expect(pendingCheckInCommand(store, 'ator-a', 'sessao-1')).not.toBe('invalida')
})

test('armazenamento local bloqueado não impede o registro', () => {
  const denied = {
    getItem: () => { throw new Error('denied') },
    setItem: () => { throw new Error('denied') },
    removeItem: () => { throw new Error('denied') },
  }
  expect(pendingCheckInCommand(denied, 'ator', 'sessao')).toMatch(/^[0-9a-f-]{36}$/)
  expect(() => clearPendingCheckIn(denied, 'ator', 'sessao')).not.toThrow()
})
