/** Pré-voo de piloto: fatos observáveis, sem aprovar regimento ou infraestrutura por inferência. */
import type { Prisma } from '@prisma/client'
import { inspectOfficialConfiguration } from './official-configuration'
import { loadMediaDestinations } from './media-control'
import { mailTransportConfigured } from './mail-delivery'
import { inspectTenantAssetReferences } from './pilot-assets'

type Reader = Prisma.TransactionClient
export type PilotCheck = { id: string; ok: boolean; detail: string }

export async function inspectPilotPreflight(db: Reader, tenantSlug: string,
  env: { DATABASE_URL?: string; SMTP_HOST?: string; SMTP_FROM?: string; PUBLIC_BASE_URL?: string; SMTP_USER?: string; SMTP_PASSWORD?: string } = {
    DATABASE_URL: process.env.DATABASE_URL, SMTP_HOST: process.env.SMTP_HOST,
    SMTP_FROM: process.env.SMTP_FROM, PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    SMTP_USER: process.env.SMTP_USER, SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  }, assetRoots?: { images?: string; public?: string }) {
  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug },
    select: { id: true, slug: true, name: true, active: true } })
  if (!tenant) throw new Error(`Câmara não encontrada: ${tenantSlug}`)
  const [configuration, revision, users, officialSessions, destinations, assets] = await Promise.all([
    inspectOfficialConfiguration(db, tenant.id),
    db.officialConfigurationRevision.findFirst({ where: { tenantId: tenant.id }, orderBy: { version: 'desc' },
      select: { version: true, snapshotSha256: true, approvalReference: true } }),
    db.user.findMany({ where: { tenantId: tenant.id, active: true }, select: { role: true, id: true } }),
    db.session.count({ where: { tenantId: tenant.id, official: true } }),
    loadMediaDestinations(tenant.id).catch(() => null),
    inspectTenantAssetReferences(db, tenant.id, assetRoots),
  ])
  const hasRole = (role: string) => users.some((user) => user.role === role)
  const mediaManagers = users.filter((user) => ['media_operator', 'session_operator', 'tenant_admin'].includes(user.role))
  const checks: PilotCheck[] = [
    { id: 'tenant_active', ok: tenant.active, detail: tenant.active ? 'Câmara ativa.' : 'Câmara inativa.' },
    { id: 'configuration_complete', ok: configuration.ready,
      detail: configuration.ready ? 'Estrutura institucional completa para revisão.' :
        `Pendências: ${configuration.checks.filter((check) => !check.ok).map((check) => check.label).join(', ')}.` },
    { id: 'configuration_approved', ok: configuration.ready && revision?.snapshotSha256 === configuration.snapshotSha256,
      detail: revision?.snapshotSha256 === configuration.snapshotSha256 ? `Revisão v${revision.version} coincide com o cadastro atual.` :
        'Nenhuma revisão aprovada coincide com o cadastro atual.' },
    { id: 'roles', ok: hasRole('tenant_admin') && hasRole('session_operator') && hasRole('media_operator') && mediaManagers.length >= 2,
      detail: `Administração: ${users.filter((user) => user.role === 'tenant_admin').length}; Mesa: ${users.filter((user) => user.role === 'session_operator').length}; mídia: ${users.filter((user) => user.role === 'media_operator').length}.` },
    { id: 'postgresql', ok: /^postgres(ql)?:\/\//.test(env.DATABASE_URL ?? ''),
      detail: /^postgres(ql)?:\/\//.test(env.DATABASE_URL ?? '') ? 'Processo conectado a PostgreSQL.' : 'Processo não conectado a PostgreSQL.' },
    { id: 'mail_transport', ok: mailTransportConfigured(env),
      detail: mailTransportConfigured(env) ? 'Parâmetros SMTP e URL pública presentes; entrega real ainda precisa de prova.' :
        'SMTP_HOST, SMTP_FROM ou PUBLIC_BASE_URL ausente.' },
    { id: 'media_destinations', ok: Boolean(destinations?.some((item) => item.publicUrl)),
      detail: destinations === null ? 'Arquivo privado de destinos ausente ou inválido.' :
        `${destinations.length} destino(s), ${destinations.filter((item) => item.publicUrl).length} com URL pública.` },
    { id: 'asset_references', ok: assets.ok,
      detail: `${assets.images} imagem(ns) referenciada(s): ${assets.imagesMissing} ausente(s), ${assets.imagesInvalid} inválida(s). ` +
        `${assets.documentsLocal} anexo(s) local(is) encontrado(s), ${assets.documentsMissing} ausente(s), ` +
        `${assets.documentsInvalid} inválido(s), ${assets.documentsRemote} remoto(s) sem verificação local.` },
  ]
  return {
    checkedAt: new Date().toISOString(), tenant: { slug: tenant.slug, name: tenant.name },
    automaticReady: checks.every((check) => check.ok), checks,
    facts: { officialSessions, configurationVersion: revision?.version ?? null },
    institutionalEvidence: [
      'Regimento, composição e regras conferidos pela Câmara',
      'Backup de banco e arquivos restaurado com RTO/RPO medidos',
      'Convocação externa com entrega e ciência comprovadas',
      'Canal social observado em dispositivo e rede externos',
      'Treinamento, acessibilidade e ensaio longo aceitos',
    ].map((label) => ({ label, state: 'pendente_de_aceite' as const })),
    institutionalPilotApproved: false,
  }
}
