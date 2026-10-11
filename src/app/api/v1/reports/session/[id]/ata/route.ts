/**
 * GET /api/v1/reports/session/:id/ata — minuta de ata ESTRUTURADA, gerada
 * EXCLUSIVAMENTE de dados persistidos da sessão (nenhum dado improvisado):
 * abertura, expediente, presença consolidada, votações com resultado (nominal
 * exceto secreta), discursos e encerramento + código de verificação (head da
 * cadeia de auditoria truncado, igual ao espelho).
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { loadSession } from '@/lib/server/loaders'
import { verifyChain } from '@/lib/server/audit'
import { currentAttendance, tenantSettings } from '@/lib/server/domain'
import {
  parseNominalDetail,
  parseResultCounts,
  sessionLabel,
  speechElapsedSeconds,
} from '@/lib/server/serializers'
import { SESSION_TYPE_LABEL, type AtaReportView } from '@/lib/contracts'
import { loadVotingBases } from '@/lib/server/voting-report'
import { PERMISSIONS } from '@/lib/server/rbac'

export const dynamic = 'force-dynamic'

const fmtDateTime = (d: Date | null): string =>
  d ? d.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' }) : '—'

export const GET = apiHandler(async (req: NextRequest, ctx, _correlationId) => {
  const actor = await resolveActor(req)
  const { id } = await ctx.params
  const session = await loadSession(actor, id)

  const [tenant, agenda, attendance, votings, speeches, parliamentarianCount, chainEvents] =
    await Promise.all([
      db.tenant.findUnique({ where: { id: session.tenantId } }),
      db.agendaItem.findMany({ where: { sessionId: session.id }, orderBy: { order: 'asc' } }),
      currentAttendance(db, session.id, session.tenantId),
      db.voting.findMany({
        where: { sessionId: session.id, status: { in: ['closed', 'annulled'] }, resultStatus: { not: null } },
        orderBy: { createdAt: 'asc' },
      }),
      db.speech.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: 'asc' },
        include: { parliamentarian: true },
      }),
      db.parliamentarian.count({ where: { tenantId: session.tenantId, active: true } }),
      db.auditEvent.findMany({
        where: { tenantId: session.tenantId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ])
  if (!tenant) throw notFound('Câmara não encontrada.')

  const votingBases = await loadVotingBases(db, votings, PERMISSIONS['voting.impediment.reason.read'].includes(actor.role))

  const settings = tenantSettings(tenant, parliamentarianCount)
  const chain = verifyChain(chainEvents)
  const verificationCode = chain.head ? chain.head.slice(0, 12).toUpperCase() : '—'

  const byCategory = new Map<string, string[]>()
  for (const row of attendance.rows) {
    if (row.present) continue
    const list = byCategory.get(row.status) ?? []
    list.push(row.name)
    byCategory.set(row.status, list)
  }

  const openingTime = session.openedAt
    ? session.openedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '—'
  const opening = `Aos ${fmtDateTime(session.scheduledAt)}, no ${session.location}, sob a presidência do(a) Ver. ${session.presidentName ?? '—'}${
    session.secretaryName ? ` e secretariado por ${session.secretaryName}` : ''
  }, iniciou-se ${sessionLabel(session)} (${SESSION_TYPE_LABEL[session.type as 'ordinaria'] ?? session.type}), com ${attendance.quorum.present} vereador(es) presente(s) de ${attendance.quorum.total} membros (mínimo regimental: ${settings.quorumMinimum}).`

  const closing = session.closedAt
    ? `Nada mais havendo a tratar, o(a) Presidente declarou encerrados os trabalhos às ${session.closedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}, lavrando-se a presente ata, que foi lida e aprovada.`
    : 'Sessão ainda não encerrada — minuta parcial com os dados persistidos até o momento.'

  const ata: AtaReportView = {
    session: {
      id: session.id,
      label: sessionLabel(session),
      type: session.type as AtaReportView['session']['type'],
      number: session.number,
      year: session.year,
      scheduledAt: session.scheduledAt.toISOString(),
      openedAt: session.openedAt ? session.openedAt.toISOString() : null,
      closedAt: session.closedAt ? session.closedAt.toISOString() : null,
      presidentName: session.presidentName ?? null,
      secretaryName: session.secretaryName ?? null,
      location: session.location,
      status: session.status as AtaReportView['session']['status'],
    },
    opening: `${openingTime} — ${opening}`,
    attendanceSummary: {
      presentCount: attendance.quorum.present,
      totalMembers: attendance.quorum.total,
      requiredQuorum: settings.quorumMinimum,
      present: attendance.rows.filter((r) => r.present).map((r) => r.name),
      byCategory: [...byCategory.entries()].map(([status, names]) => ({ status, names })),
    },
    expediente: agenda
      .filter((i) => i.section === 'expediente')
      .map((i) => ({
        order: i.order,
        title: i.title,
        status: i.status,
        resultSummary: i.resultSummary ?? null,
      })),
    votings: votings.map((v) => {
      const partyByName = new Map(attendance.rows.map((r) => [r.name, r.party]))
      const nominal =
        v.status === 'closed' && v.mode === 'nominal' && v.resultDetail
          ? (parseNominalDetail(v.resultDetail) ?? []).map((d) => ({
              name: d.name,
              party: partyByName.get(d.name) ?? '',
              value: d.value,
            }))
          : null
      return {
        id: v.id,
        question: v.question,
        mode: v.mode as AtaReportView['votings'][number]['mode'],
        rule: v.rule as AtaReportView['votings'][number]['rule'],
        result: v.resultStatus ?? '—',
        counts: parseResultCounts(v.resultCounts),
        nominal,
        basis: votingBases[v.id],
      }
    }),
    speeches: speeches.map((s) => ({
      speakerName: s.parliamentarian?.name ?? s.externalSpeaker ?? 'Orador externo',
      kind: s.kind,
      subject: s.subject ?? null,
      durationSeconds: speechElapsedSeconds(s),
    })),
    closing,
    verificationCode,
  }

  return Response.json({ ata })
})
