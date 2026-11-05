import { createHash } from 'crypto'
import type { Prisma } from '@prisma/client'
import { tenantSettings } from './domain'

type Reader = Prisma.TransactionClient

export type OfficialCheck = { id: string; label: string; ok: boolean; detail: string }

/** Snapshot ordenado: qualquer alteração institucional relevante exige nova aprovação. */
export async function inspectOfficialConfiguration(db: Reader, tenantId: string) {
  const [tenant, legislatures, parliamentarians, mandates, boardPositions, parties, leaves, blocs, matterTypes, users] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    db.legislature.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    db.parliamentarian.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, select: { id: true, name: true, active: true, party: true } }),
    db.mandate.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, select: { id: true, parliamentarianId: true, legislatureId: true, startDate: true, endDate: true } }),
    db.boardPosition.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, select: { id: true, legislatureId: true, parliamentarianId: true, role: true, startDate: true, endDate: true, status: true } }),
    db.party.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, select: { id: true, acronym: true, name: true, active: true } }),
    db.leave.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, select: { id: true, parliamentarianId: true, substituteId: true, kind: true, startDate: true, endDate: true } }),
    db.bloc.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, select: { id: true, name: true, partyAcronyms: true, active: true } }),
    db.matterTypeConfig.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, select: { id: true, code: true, name: true, defaultRegime: true, active: true } }),
    db.user.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, select: { id: true, role: true, active: true, parliamentarianId: true } }),
  ])
  const current = legislatures.filter((item) => item.current)
  const legislature = current.length === 1 ? current[0] : null
  const active = parliamentarians.filter((item) => item.active)
  const activeIds = new Set(active.map((item) => item.id))
  const parliamentarianIds = new Set(parliamentarians.map((item) => item.id))
  const currentMandates = mandates.filter((item) => item.legislatureId === legislature?.id && activeIds.has(item.parliamentarianId))
  const mandateIds = new Set(currentMandates.map((item) => item.parliamentarianId))
  const now = new Date()
  const currentBoard = boardPositions.filter((item) => item.legislatureId === legislature?.id && activeIds.has(item.parliamentarianId) &&
    item.status === 'confirmed' && item.startDate <= now && (item.endDate === null || item.endDate >= now))
  const partyAcronyms = new Set(parties.filter((item) => item.active).map((item) => item.acronym.toUpperCase()))
  const settings = tenantSettings(tenant, active.length)
  const checks: OfficialCheck[] = [
    { id: 'identity', label: 'Identidade da Câmara', ok: !!(tenant.name.trim() && tenant.city.trim() && /^[A-Z]{2}$/.test(tenant.uf)), detail: 'Nome, município e UF válidos.' },
    { id: 'legislature', label: 'Legislatura vigente', ok: !!legislature, detail: 'Deve haver exatamente uma legislatura marcada como atual.' },
    { id: 'mandates', label: 'Mandatos', ok: active.length > 0 && active.every((item) => mandateIds.has(item.id)), detail: `${mandateIds.size} de ${active.length} parlamentares ativos vinculados à legislatura atual.` },
    { id: 'parties', label: 'Partidos', ok: active.length > 0 && active.every((item) => partyAcronyms.has(item.party.toUpperCase())), detail: 'Cada parlamentar ativo precisa de partido cadastrado e ativo.' },
    { id: 'board', label: 'Mesa Diretora', ok: currentBoard.some((item) => item.role === 'presidente') && currentBoard.some((item) => item.role === 'primeiro_secretario'), detail: 'Presidência e primeira secretaria vinculadas à legislatura atual.' },
    { id: 'leaves', label: 'Licenças e suplência', ok: leaves.every((item) => parliamentarianIds.has(item.parliamentarianId) && (!item.substituteId || (parliamentarianIds.has(item.substituteId) && item.substituteId !== item.parliamentarianId)) && (!item.endDate || item.endDate >= item.startDate)), detail: 'Afastamentos e suplentes, quando cadastrados, devem pertencer à mesma Câmara e ter datas válidas.' },
    { id: 'operators', label: 'Responsável pela configuração', ok: users.some((item) => item.active && item.role === 'tenant_admin'), detail: 'Ao menos um administrador ativo da Câmara deve conferir as regras.' },
    { id: 'quorum', label: 'Quórum', ok: settings.quorumMinimum > 0 && settings.quorumMinimum <= currentMandates.length, detail: `Quórum configurado: ${settings.quorumMinimum}; mandatos vinculados: ${currentMandates.length}.` },
    { id: 'sessions', label: 'Tipos e prazos de sessão', ok: settings.enabledSessionTypes.length > 0 && settings.minimumNoticeHours >= 0 && settings.minimumAmendmentHours >= 0, detail: 'Tipos habilitados e prazos regimentais configurados.' },
    { id: 'voting', label: 'Política de votação', ok: Object.keys(settings.votingPoliciesByMatterType).length > 0, detail: 'Defina ao menos uma regra explícita de votação por tipo de matéria.' },
  ]
  const snapshot = {
    tenant: { id: tenant.id, name: tenant.name, city: tenant.city, uf: tenant.uf, timezone: tenant.timezone, settings: tenant.settings },
    legislatures, parliamentarians, mandates, boardPositions, parties, leaves, blocs, matterTypes, users,
  }
  const snapshotJson = JSON.stringify(snapshot)
  const snapshotSha256 = createHash('sha256').update(snapshotJson).digest('hex')
  return { checks, ready: checks.every((item) => item.ok), snapshotJson, snapshotSha256 }
}
