import { describe, expect, test } from 'bun:test'
import { readDisplaySnapshot, writeDisplaySnapshot } from '../src/modules/display/snapshot'
import type { PublicLiveViewExt } from '../src/lib/api-client'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

const view = {
  tenant: { name: 'Câmara A', city: 'Cidade A', uf: 'BA', primaryColor: '#123456', accentColor: '#abcdef', logoUrl: null },
  session: null,
  transmissionLink: null,
  localReplay: null,
  presentMembers: [],
  agenda: [],
  currentVoting: null,
  lastResults: [],
  speakingNow: null,
} satisfies PublicLiveViewExt

describe('snapshot do telão por Câmara', () => {
  test('não reaproveita a visão da Câmara anterior ao trocar de tenant', () => {
    const storage = memoryStorage()
    writeDisplaySnapshot(storage, { tenantId: 'camara-a', view, manualProfile: 'votacao' })

    expect(readDisplaySnapshot(storage, 'camara-b')).toEqual({ tenantId: 'camara-b', view: null, manualProfile: null })
    expect(readDisplaySnapshot(storage, 'camara-a')).toEqual({ tenantId: 'camara-a', view, manualProfile: 'votacao' })
  })

  test('ignora snapshot malformado, identificado para outra Câmara ou com perfil inválido', () => {
    const storage = memoryStorage()
    storage.setItem('legis.display.snapshot.camara-b', '{')
    expect(readDisplaySnapshot(storage, 'camara-b').view).toBeNull()

    storage.setItem('legis.display.snapshot.camara-b', JSON.stringify({ tenantId: 'camara-a', view }))
    expect(readDisplaySnapshot(storage, 'camara-b').view).toBeNull()

    storage.setItem('legis.display.snapshot.camara-b', JSON.stringify({ tenantId: 'camara-b', view, manualProfile: 'desconhecido' }))
    expect(readDisplaySnapshot(storage, 'camara-b').manualProfile).toBeNull()
  })
})
