import { expect, test } from 'bun:test'
import { createLocalPreflightView, localPreflightHandler } from '@/lib/local-preflight-preview'

test('pacote verificado não libera abertura sem autoridade local', () => {
  const view = createLocalPreflightView({ tenantId: 'camara-a', deviceId: 'mesa-1',
    sessions: [{ sessionId: 'sessao-27', state: 'ready', artifactCount: 24, totalBytes: 4096,
      prepared: { revisionNumber: 4, importedAt: '2026-11-11T14:32:00.000Z' } }] })
  expect(view).toMatchObject({ version: 1, tenantId: 'camara-a', deviceId: 'mesa-1',
    operation: 'read_only', sessions: [{ sessionId: 'sessao-27', packageState: 'ready',
      revisionNumber: 4, artifactCount: 24, canOpenSession: false }] })
  expect(view.sessions[0]?.blockers).toContain('Autoridade local de sessão ainda não habilitada.')
})

test('pacote incompleto ou corrompido nunca aparece como pronto', () => {
  const view = createLocalPreflightView({ tenantId: 'camara-a', deviceId: 'mesa-1', sessions: [
    { sessionId: 's1', state: 'incomplete', reason: 'Importação interrompida.' },
    { sessionId: 's2', state: 'corrupt', reason: 'Assinatura inválida.' },
  ] })
  expect(view.sessions.map((session) => [session.packageState, session.canOpenSession]))
    .toEqual([['incomplete', false], ['corrupt', false]])
  expect(view.sessions[0]?.blockers).toContain('Importação interrompida.')
  expect(view.sessions[1]?.blockers).toContain('Assinatura inválida.')
})

test('API local de prévia é somente leitura e não armazena respostas', async () => {
  const handler = localPreflightHandler({ html: '<!doctype html><title>Pré-voo</title>',
    readView: async () => createLocalPreflightView({ tenantId: 'camara-a', deviceId: 'mesa-1', sessions: [] }) })
  const api = await handler(new Request('http://127.0.0.1:3000/api/status'))
  expect(api.status).toBe(200)
  expect(api.headers.get('cache-control')).toBe('no-store')
  expect((await api.json()).operation).toBe('read_only')
  const page = await handler(new Request('http://127.0.0.1:3000/'))
  expect(page.status).toBe(200)
  expect(page.headers.get('content-security-policy')).toContain("default-src 'self'")
  expect(await page.text()).toContain('Pré-voo')
  expect((await handler(new Request('http://127.0.0.1:3000/api/status', { method: 'POST' }))).status).toBe(405)
  expect((await handler(new Request('http://127.0.0.1:3000/secret'))).status).toBe(404)
  expect((await handler(new Request('http://site-externo.invalid:3000/api/status'))).status).toBe(403)
})
