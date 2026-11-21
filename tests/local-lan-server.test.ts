import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeLocalDevice, enrollLocalDevice, trustLocalTransferKey, loadLocalDevice } from '../src/lib/local-device-keystore'
import { startLocalLanServer } from '../src/lib/local-lan-server'

const createdDirs: string[] = []
const serversToClose: Array<{ close(): void }> = []

afterEach(async () => {
  while (serversToClose.length > 0) {
    serversToClose.pop()!.close()
  }
  while (createdDirs.length > 0) {
    await rm(createdDirs.pop()!, { recursive: true, force: true })
  }
})

describe('local-lan-server', () => {
  it('serves desktop UI, records attendance & voting in signed journal, updates snapshot, and broadcasts via WebSocket', async () => {
    const tempParent = await mkdtemp(join(tmpdir(), 'edoc-lan-'))
    createdDirs.push(tempParent)
    const root = join(tempParent, 'device')

    const passphrase = 'test-passphrase-lan-server'
    const tenantId = 'tenant-lan-1'
    const deviceId = 'device-lan-1'
    const sessionId = 'session-lan-1'

    await initializeLocalDevice({
      root,
      tenantId,
      baseUrl: 'https://edocbrplenario.com.br',
      passphrase,
    })
    await enrollLocalDevice(root, deviceId)
    const transferPair = generateKeyPairSync('ed25519')
    const transferPublicPem = transferPair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const transferSpkiSha256 = createHash('sha256')
      .update(transferPair.publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex')
    await trustLocalTransferKey({
      root,
      keyId: 'transfer-key-1',
      publicKeyPem: transferPublicPem,
      expectedSpkiSha256: transferSpkiSha256,
    })
    const { privateKey, trustedKeys } = await loadLocalDevice({ root, passphrase })

    const lan = startLocalLanServer({
      root,
      tenantId,
      deviceId,
      baseUrl: 'https://edocbrplenario.com.br',
      privateKey,
      trustedKeys,
      hostname: '127.0.0.1',
      port: 0,
      fetchImpl: async (input) => {
        const u = String(input)
        if (u.endsWith('/authority/grant')) {
          return new Response(JSON.stringify({ granted: true, epoch: 2 }), { status: 200 })
        }
        if (u.endsWith('/authority/release')) {
          return new Response(JSON.stringify({ released: true, epoch: 2 }), { status: 200 })
        }
        if (u.endsWith('/authority/reconcile')) {
          return new Response(JSON.stringify({
            reconciled: true,
            sessionId,
            epoch: 1,
            ackedSeqs: [1, 2, 3, 4, 5, 6, 7, 8, 9],
            appliedCount: 9,
            deduplicatedCount: 0,
            quarantined: [],
          }), { status: 200 })
        }
        return new Response(JSON.stringify({}), { status: 404 })
      },
    })
    serversToClose.push(lan)

    const base = `http://127.0.0.1:${lan.port}`

    // 1. GET /health
    const healthRes = await fetch(`${base}/health`)
    expect(healthRes.status).toBe(200)
    const health = await healthRes.json()
    expect(health.ok).toBe(true)

    // 2. GET / (6-screen Desktop UI)
    const uiRes = await fetch(`${base}/`)
    expect(uiRes.status).toBe(200)
    const html = await uiRes.text()
    expect(html).toContain('Pareamento, Identidade e Cofre Local')
    expect(html).toContain('Central de Sessões Importadas')
    expect(html).toContain('Pré-Voo e Concessão de Autoridade')
    expect(html).toContain('Mesa de Condução Local (LAN)')
    expect(html).toContain('Monitor de Rede LAN e Telões')
    expect(html).toContain('Diário Criptográfico e Reconciliação')

    // 3. GET /api/local/status & /preflight
    const statusRes = await fetch(`${base}/api/local/status`)
    expect(statusRes.status).toBe(200)
    const status = await statusRes.json()
    expect(status.journalVerified).toBe(true)
    expect(status.tenantId).toBe(tenantId)
    expect(status.deviceId).toBe(deviceId)
    expect(Array.isArray(status.lanAddresses)).toBe(true)

    const preflightRes = await fetch(`${base}/api/local/sessions/${sessionId}/preflight`)
    expect(preflightRes.status).toBe(200)
    const preflight = await preflightRes.json()
    expect(preflight.disk.ok).toBe(true)
    expect(preflight.disk.freeBytes).toBeGreaterThan(0)

    // 4. Connect WebSocket client on /ws?kind=telao
    const wsMessages: any[] = []
    const ws = new WebSocket(`ws://127.0.0.1:${lan.port}/ws?kind=telao`)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WS connect timeout')), 3000)
      ws.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      })
      ws.addEventListener('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
    ws.addEventListener('message', (event) => {
      try {
        wsMessages.push(JSON.parse(String(event.data)))
      } catch {
        // ignore
      }
    })

    try {
      // 5. Attendance check_in
      const attRes = await fetch(`${base}/api/local/sessions/${sessionId}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parliamentarianId: 'parl_1', kind: 'check_in' }),
      })
      expect(attRes.status).toBe(200)

      // 6. Open voting
      const openVoteRes = await fetch(`${base}/api/local/sessions/${sessionId}/votings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ votingId: 'v1', question: 'PL 012/2026 — Saúde', mode: 'nominal' }),
      })
      expect(openVoteRes.status).toBe(201)

      // 7. Cast vote (sim)
      const castRes = await fetch(`${base}/api/local/sessions/${sessionId}/votes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ votingId: 'v1', parliamentarianId: 'parl_1', value: 'sim' }),
      })
      expect(castRes.status).toBe(200)

      // 8. Close voting
      const closeRes = await fetch(`${base}/api/local/sessions/${sessionId}/votings/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ votingId: 'v1' }),
      })
      expect(closeRes.status).toBe(200)

      // 9. Freeze display
      const freezeRes = await fetch(`${base}/api/local/sessions/${sessionId}/display/freeze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frozen: true }),
      })
      expect(freezeRes.status).toBe(200)

      // 10. Check snapshot
      const snapRes = await fetch(`${base}/api/local/sessions/${sessionId}/snapshot`)
      expect(snapRes.status).toBe(200)
      const snap = await snapRes.json()
      expect(snap.presentParliamentarianIds).toEqual(['parl_1'])
      expect(snap.activeVoting).not.toBeNull()
      expect(snap.activeVoting.status).toBe('closed')
      expect(snap.activeVoting.counts.sim).toBe(1)
      expect(snap.displayFrozen).toBe(true)

      // 11. Check WebSocket broadcast receipt
      await new Promise((r) => setTimeout(r, 100))
      const freezeEvents = wsMessages.filter((m) => m.event === 'display.freeze' && m.data?.sessionId === sessionId)
      const voteEvents = wsMessages.filter((m) => m.event === 'vote.cast' && m.data?.sessionId === sessionId)
      expect(freezeEvents.length).toBe(1)
      expect(voteEvents.length).toBe(1)
      expect(freezeEvents[0].data.sequence).toBe(5)

      // 12. LAN client pages: /telao & /vereador
      const telaoRes = await fetch(`${base}/telao?sessionId=${sessionId}`)
      expect(telaoRes.status).toBe(200)
      expect(await telaoRes.text()).toContain('Telão LAN')

      const vereadorRes = await fetch(`${base}/vereador?sessionId=${sessionId}`)
      expect(vereadorRes.status).toBe(200)
      expect(await vereadorRes.text()).toContain('Terminal do Vereador (LAN)')

      // 13. Speeches, Agenda, Broadcast Snapshot, Authority Grant/Release, Backup, Client Disconnect
      const speechRes = await fetch(`${base}/api/local/sessions/${sessionId}/speeches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', parliamentarianId: 'parl_1' }),
      })
      expect(speechRes.status).toBe(200)

      const agendaRes = await fetch(`${base}/api/local/sessions/${sessionId}/agenda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'vista', itemTitle: 'PL 012/2026', parliamentarianId: 'parl_2' }),
      })
      expect(agendaRes.status).toBe(200)

      const snap2 = await fetch(`${base}/api/local/sessions/${sessionId}/snapshot`).then((r) => r.json())
      expect(snap2.activeSpeech?.parliamentarianId).toBe('parl_1')
      expect(snap2.activeAgendaItem?.incident).toBe('vista')

      const bcastRes = await fetch(`${base}/api/local/sessions/${sessionId}/broadcast-snapshot`, { method: 'POST' })
      expect(bcastRes.status).toBe(200)
      const bcastData = await bcastRes.json()
      expect(bcastData.clientsNotified).toBeGreaterThanOrEqual(1)

      const grantRes = await fetch(`${base}/api/local/sessions/${sessionId}/authority/grant`, { method: 'POST' })
      expect(grantRes.status).toBe(200)
      const releaseRes = await fetch(`${base}/api/local/sessions/${sessionId}/authority/release`, { method: 'POST' })
      expect(releaseRes.status).toBe(200)

      const backupRes = await fetch(`${base}/api/local/sessions/${sessionId}/backup`)
      expect(backupRes.status).toBe(200)
      const backupJson = await backupRes.json()
      expect(backupJson.sessionId).toBe(sessionId)
      expect(backupJson.events.length).toBeGreaterThanOrEqual(9)

      const recRes = await fetch(`${base}/api/local/sessions/${sessionId}/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epoch: 1 }),
      })
      expect(recRes.status).toBe(200)
      const recJson = await recRes.json()
      expect(recJson.lastAckedSeq).toBe(9)

      const journalAfter = await fetch(`${base}/api/local/sessions/${sessionId}/journal`).then((r) => r.json())
      expect(journalAfter.lastAckedSeq).toBe(9)
      expect(journalAfter.pendingCount).toBe(0)

      const stAfter = await fetch(`${base}/api/local/status`).then((r) => r.json())
      expect(stAfter.lanClients.length).toBeGreaterThanOrEqual(1)
      const clientId = stAfter.lanClients[0].id
      const discRes = await fetch(`${base}/api/local/clients/${clientId}/disconnect`, { method: 'POST' })
      expect(discRes.status).toBe(200)
    } finally {
      ws.close()
    }
  })
})
