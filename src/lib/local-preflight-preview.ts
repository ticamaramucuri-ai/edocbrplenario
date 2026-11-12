/** Read-only projection for the first desktop/mobile laboratory preview. */
import type { LocalPreparationStatus } from './local-preparation-status'
import type { LocalSessionSummary } from './local-session-summary'

type SessionInput = Pick<LocalPreparationStatus, 'sessionId' | 'state' | 'reason' | 'artifactCount' | 'totalBytes'> & {
  prepared?: { revisionNumber: number; importedAt: string }
}

export type LocalPreflightView = {
  version: 1
  tenantId: string
  deviceId: string
  operation: 'read_only'
  sessions: Array<{
    sessionId: string
    packageState: LocalPreparationStatus['state']
    revisionNumber: number | null
    importedAt: string | null
    artifactCount: number
    totalBytes: number
    canOpenSession: false
    blockers: string[]
  }>
}

export function createLocalPreflightView(args: {
  tenantId: string
  deviceId: string
  sessions: readonly SessionInput[]
}): LocalPreflightView {
  return {
    version: 1, tenantId: args.tenantId, deviceId: args.deviceId, operation: 'read_only',
    sessions: args.sessions.map((session) => ({
      sessionId: session.sessionId,
      packageState: session.state,
      revisionNumber: session.prepared?.revisionNumber ?? null,
      importedAt: session.prepared?.importedAt ?? null,
      artifactCount: session.artifactCount ?? 0,
      totalBytes: session.totalBytes ?? 0,
      canOpenSession: false,
      blockers: [
        ...(session.state === 'ready' ? [] : [session.reason ?? 'Pacote local não verificado.']),
        'Autoridade local de sessão ainda não habilitada.',
      ],
    })),
  }
}

const commonHeaders = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer' }

export function localPreflightHandler(args: {
  html: string
  script?: string
  css?: string
  readView: () => Promise<LocalPreflightView>
  readSummary?: (sessionId: string) => Promise<LocalSessionSummary>
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== '127.0.0.1') return new Response('Origem não permitida.', { status: 403, headers: commonHeaders })
    if (request.method !== 'GET') return new Response('Método não permitido.', { status: 405, headers: commonHeaders })
    if (url.pathname === '/api/status') {
      try { return Response.json(await args.readView(), { headers: commonHeaders }) }
      catch { return Response.json({ error: 'Inventário local indisponível.' }, { status: 503, headers: commonHeaders }) }
    }
    if (url.pathname.startsWith('/api/sessions/') && args.readSummary) {
      const rawId = url.pathname.slice('/api/sessions/'.length)
      if (!rawId || rawId.includes('/') || rawId.length > 600) return new Response('Não encontrado.', { status: 404, headers: commonHeaders })
      let sessionId: string
      try { sessionId = decodeURIComponent(rawId) } catch { return new Response('Não encontrado.', { status: 404, headers: commonHeaders }) }
      try {
        const view = await args.readView()
        if (!view.sessions.some((session) => session.sessionId === sessionId && session.packageState === 'ready')) {
          return new Response('Não encontrado.', { status: 404, headers: commonHeaders })
        }
        return Response.json(await args.readSummary(sessionId), { headers: commonHeaders })
      } catch { return Response.json({ error: 'Resumo local indisponível.' }, { status: 503, headers: commonHeaders }) }
    }
    if (url.pathname === '/') return new Response(args.html, { headers: { ...commonHeaders,
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } })
    if (url.pathname === '/app.js' && args.script) return new Response(args.script, { headers: { ...commonHeaders,
      'content-type': 'text/javascript; charset=utf-8' } })
    if (url.pathname === '/app.css' && args.css) return new Response(args.css, { headers: { ...commonHeaders,
      'content-type': 'text/css; charset=utf-8' } })
    return new Response('Não encontrado.', { status: 404, headers: commonHeaders })
  }
}
