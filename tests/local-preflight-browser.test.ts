import { afterAll, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createLocalPreflightView, localPreflightHandler } from '@/lib/local-preflight-preview'

const appRoot = join(process.cwd(), 'src/local-app')
const [html, script, css] = await Promise.all(['index.html', 'app.js', 'app.css']
  .map((file) => readFile(join(appRoot, file), 'utf8')))
let broken = false
const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: localPreflightHandler({ html, script, css,
  readSummary: async (sessionId) => ({ sessionId, revisionNumber: 4,
    agenda: [{ title: 'Projeto de Lei 18/2026', order: 1 }],
    documents: [{ name: 'Parecer.pdf', mimeType: 'application/pdf', sizeBytes: 4096 }], canVote: false }),
  readView: async () => {
    if (broken) throw new Error('synthetic failure')
    return createLocalPreflightView({ tenantId: 'camara-a', deviceId: 'mesa-1', sessions: [
      { sessionId: 'sessao-27', state: 'ready', artifactCount: 24, totalBytes: 4096,
        prepared: { revisionNumber: 4, importedAt: '2026-11-11T14:32:00.000Z' } },
      { sessionId: 'sessao-28', state: 'incomplete', reason: 'Importação interrompida.' },
    ] })
  } }) })
afterAll(() => server.stop())

test('desktop e celular distinguem pacote verificado de sessão autorizada', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport })
      await page.goto(`http://127.0.0.1:${server.port}/`)
      await page.getByText('Sessão sessao-27').waitFor()
      expect(await page.getByText('Pacote verificado').count()).toBe(1)
      expect(await page.getByText('Abertura bloqueada').count()).toBeGreaterThan(0)
      expect(await page.getByText('Importação interrompida.').count()).toBe(1)
      await page.getByRole('button', { name: 'Ver pauta e documentos' }).click()
      await page.getByText('Projeto de Lei 18/2026').waitFor()
      expect(await page.getByText('Parecer.pdf').count()).toBe(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.close()
    }
  } finally { await browser.close() }
})

test('falha do inventário não mostra o último pacote como atual', async () => {
  broken = true
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${server.port}/`)
    await page.getByText('Inventário indisponível').waitFor()
    expect(await page.getByText('Sessão sessao-27').count()).toBe(0)
  } finally { broken = false; await browser.close() }
})
