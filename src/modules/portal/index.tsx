'use client'

/**
 * Módulo Portal Público (Fase 6) — simulação white-label do portal de
 * transparência. Tabs:
 *  - Ao Vivo: conteúdo existente (poll 15s em /api/v1/public/live);
 *  - Pesquisa de Matérias: filtros + paginação por cursor + detalhe (Sheet);
 *  - Sessões: lista pública (futuras/em andamento/históricas) + detalhe (Sheet);
 *  - Publicações (Fase 11): diário eletrônico com paginação + detalhe com
 *    código de verificação e selo de revogação;
 *  - Audiências (Fase 11): audiências públicas com perguntas respondidas e
 *    formulário de participação popular SEM autenticação;
 *  - Acompanhar (Fase 19): assinatura do cidadão por e-mail com dupla
 *    confirmação (double opt-in) de matéria/sessão/audiência;
 *  - Dados Abertos: cards por dataset com download JSON/CSV + snippet de URL;
 *  - Publicações (Fase 11): botão "Verificar autenticidade" (Fase 19) que
 *    consulta o código no endpoint público /api/v1/public/verify.
 * Consome SOMENTE rotas públicas /api/v1/public/* (sem x-actor-id).
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Bell,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  CircleSlash,
  Clock,
  Copy,
  Database,
  Download,
  Equal,
  ExternalLink,
  Eye,
  EyeOff,
  FileJson,
  FileSpreadsheet,
  Globe,
  Info,
  Landmark,
  MailCheck,
  MapPin,
  MessageCircle,
  MessageCircleQuestion,
  Mic,
  Newspaper,
  PenLine,
  RefreshCw,
  ScrollText,
  Search,
  Send,
  ShieldCheck,
  UserCheck,
  Users,
  Vote,
  XCircle,
} from 'lucide-react'

import { api, signaturesApi } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDateTime, fmtDuration, matterLabel as fmtMatterLabel } from '@/lib/format'
import {
  AGENDA_STATUS_LABEL,
  MATTER_STATUS_LABEL,
  MATTER_TYPE_LABEL,
  MATTER_TYPE_SHORT,
  PROCEEDING_ACTION_LABEL,
  RESULT_STATUS_LABEL,
  SESSION_STATUS_LABEL,
  SESSION_TYPE_LABEL,
  SPEECH_KIND_LABEL,
  SUBSCRIPTION_TARGET_LABEL,
  VOTE_VALUE_LABEL,
  VOTING_MODE_LABEL,
  type AgendaItemStatus,
  type MatterPublicView,
  type PublicAtaView,
  type PublicLiveView,
  type PublicMatterDetail,
  type PublicSessionSummary,
  type PublicSessionDetail,
  type PublicVerifyResult,
  type SignatureVerificationView,
  type SubscriptionTargetKind,
  type VoteValueOrEmpty,
} from '@/lib/contracts'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { BrandLogo, TenantCrest } from '@/components/brand/brand-logo'
import { AGENDA_SECTION_LABEL, downloadBlob, useDebouncedValue } from '@/modules/_shared'

const POLL_MS = 15_000

const AGENDA_ICON: Record<AgendaItemStatus, React.ReactNode> = {
  pendente: <Clock className="size-3.5" />,
  em_leitura: <BookOpen className="size-3.5" />,
  em_discussao: <MessageCircle className="size-3.5" />,
  em_votacao: <Vote className="size-3.5" />,
  aprovado: <CheckCircle2 className="size-3.5 text-emerald-600" />,
  rejeitado: <XCircle className="size-3.5 text-rose-600" />,
  retirado: <CircleSlash className="size-3.5" />,
  adiado: <CalendarClock className="size-3.5" />,
}

function PublicResult({ status }: { status: string | null }) {
  if (!status) return <span className="text-zinc-500">Resultado não registrado</span>
  const label = RESULT_STATUS_LABEL[status] ?? status
  if (status === 'aprovado')
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
        <CheckCircle2 className="size-4" aria-hidden /> {label}
      </span>
    )
  if (status === 'rejeitado')
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-rose-700">
        <XCircle className="size-4" aria-hidden /> {label}
      </span>
    )
  if (status === 'empate')
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700">
        <Equal className="size-4" aria-hidden /> {label}
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold text-zinc-600">
      <AlertTriangle className="size-4" aria-hidden /> {label}
    </span>
  )
}

function PublicVoteChip({ value }: { value: VoteValueOrEmpty }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold',
        value === 'sim' && 'bg-emerald-100 text-emerald-800',
        value === 'nao' && 'bg-rose-100 text-rose-800',
        value === 'abstencao' && 'bg-amber-100 text-amber-800',
        value === 'nao_registrado' && 'bg-zinc-200 text-zinc-600'
      )}
    >
      {VOTE_VALUE_LABEL[value]}
    </span>
  )
}

/** Cronômetro local: soma ao decorrido do servidor o tempo desde o último poll. */
function useSpeakingElapsed(base: number, receivedAt: number, active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [active])
  return active ? base + Math.max(0, Math.floor((now - receivedAt) / 1000)) : base
}

function SpeakingTimer({
  speech,
  accent,
  receivedAt,
}: {
  speech: NonNullable<PublicLiveView['speakingNow']>
  accent: string
  receivedAt: number
}) {
  const active = speech.status === 'falando'
  const elapsed = useSpeakingElapsed(speech.elapsedSeconds, receivedAt, active)
  return (
    <div className="mt-3 flex items-center gap-3">
      <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: accent }} aria-live="off">
        {fmtDuration(elapsed)}
      </span>
      <span className="text-xs text-zinc-500 tabular-nums">de {fmtDuration(speech.plannedSeconds)} previstos</span>
      {speech.status === 'falando' && (
        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-600" />
          </span>
          Em palavra
        </span>
      )}
    </div>
  )
}

// ─── Tab: Ao Vivo (conteúdo original preservado) ────────────────────────────

function LiveTab({
  slug,
  onOpenApi,
}: {
  slug: string
  onOpenApi: () => void
}) {
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['public-live'],
    queryFn: () => api.publicLive(slug),
    refetchInterval: POLL_MS,
  })

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetch()}
          disabled={isFetching}
          className="border-zinc-300 text-zinc-700 hover:bg-zinc-100"
        >
          <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} /> Atualizar
        </Button>
      </div>
      {data.session ? (
        <>
          {data.transmissionLink && <section aria-label="Transmissão da sessão" className="rounded-lg border border-zinc-200 p-4">
            <h3 className="font-bold">Transmissão da sessão</h3>
            <a href={data.transmissionLink.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-2 text-sm font-medium underline" style={{ color: data.tenant.primaryColor }}><ExternalLink className="size-4" aria-hidden /> Abrir transmissão na plataforma</a>
          </section>}
          {data.localReplay && <section aria-label="Replay local da sessão" className="rounded-lg border border-zinc-200 p-4">
            <h3 className="font-bold">Replay da sessão</h3>
            <video controls preload="metadata" className="mt-3 w-full rounded" src={`/api/v1/public/sessions/${encodeURIComponent(data.session.id)}/replay?tenant=${encodeURIComponent(slug)}`} aria-label={`Replay da ${data.session.label}`} />
          </section>}
          {/* Card Sessão */}
          <section aria-label="Sessão atual" className="rounded-lg border border-zinc-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-xl font-bold leading-tight">{data.session.label}</h3>
                <p className="mt-1 text-sm text-zinc-600">
                  {data.session.scheduledAt ? fmtDateTime(data.session.scheduledAt) : '—'} ·{' '}
                  {data.session.statusLabel}
                </p>
                {data.session.presidentName && (
                  <p className="text-sm text-zinc-600">
                    Presidência: <strong>{data.session.presidentName}</strong>
                  </p>
                )}
              </div>
              <Badge
                className="border text-[11px]"
                variant="outline"
                style={{ borderColor: data.tenant.primaryColor, color: data.tenant.primaryColor }}
              >
                <UserCheck className="size-3" aria-hidden /> {data.session.statusLabel}
              </Badge>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Users className="size-4 text-zinc-500" aria-hidden />
                  {data.session.presentCount}/{data.session.totalMembers} presentes
                </span>
                <span className="text-xs text-zinc-500 tabular-nums">
                  mínimo regimental: {data.session.requiredQuorum}
                </span>
              </div>
              <Progress
                value={Math.min(100, (data.session.presentCount / Math.max(1, data.session.requiredQuorum)) * 100)}
                className="h-2.5"
                aria-label={`Quórum atual: ${data.session.presentCount} de ${data.session.requiredQuorum} necessários`}
              />
              {data.session.presentCount >= data.session.requiredQuorum && (
                <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="size-3.5" aria-hidden /> Quórum atingido
                </p>
              )}
            </div>

            {data.presentMembers.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Parlamentares presentes ({data.presentMembers.length})
                </p>
                <ul className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto custom-scroll">
                  {data.presentMembers.map((m) => (
                    <li
                      key={m.name}
                      className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700"
                    >
                      {m.name} <span className="text-zinc-500">({m.party})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Pauta ao vivo */}
            <section aria-label="Pauta ao vivo" className="rounded-lg border border-zinc-200 p-4">
              <h3 className="mb-3 flex items-center gap-2 font-bold">
                <ScrollText className="size-4" style={{ color: data.tenant.primaryColor }} aria-hidden />
                Pauta ao vivo
              </h3>
              {data.agenda.length === 0 ? (
                <p className="text-sm text-zinc-500">Pauta ainda não publicada.</p>
              ) : (
                <div className="max-h-96 space-y-4 overflow-y-auto custom-scroll pr-1">
                  {(['expediente', 'ordem_do_dia', 'comunicacoes'] as const).map((section) => {
                    const items = data.agenda.filter((i) => i.section === section)
                    if (items.length === 0) return null
                    return (
                      <div key={section}>
                        <p
                          className="mb-1.5 text-[11px] font-bold uppercase tracking-widest"
                          style={{ color: data.tenant.primaryColor }}
                        >
                          {AGENDA_SECTION_LABEL[section]}
                        </p>
                        <ol className="space-y-1.5">
                          {items.map((item) => (
                            <li key={item.id} className="flex items-start gap-2 text-sm">
                              <span className="mt-0.5 shrink-0 text-zinc-400" aria-hidden>
                                {AGENDA_ICON[item.status] ?? <Clock className="size-3.5" />}
                              </span>
                              <span className="min-w-0">
                                <span className="block leading-snug">{item.title}</span>
                                <span className="text-xs font-medium text-zinc-500">
                                  {AGENDA_STATUS_LABEL[item.status]}
                                  {item.resultSummary ? ` — ${item.resultSummary}` : ''}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            <div className="space-y-5">
              {/* Orador da vez */}
              {data.speakingNow && (
                <section
                  aria-label="Orador da vez"
                  className="rounded-lg border-2 p-4"
                  style={{ borderColor: data.tenant.accentColor }}
                >
                  <h3 className="mb-2 flex items-center gap-2 font-bold">
                    <Mic className="size-4" style={{ color: data.tenant.accentColor }} aria-hidden />
                    Orador da vez
                  </h3>
                  <p className="text-lg font-bold leading-tight">{data.speakingNow.speakerName}</p>
                  {data.speakingNow.subject && (
                    <p className="mt-0.5 text-sm text-zinc-600">{data.speakingNow.subject}</p>
                  )}
                  <SpeakingTimer
                    speech={data.speakingNow}
                    accent={data.tenant.accentColor}
                    receivedAt={dataUpdatedAt}
                  />
                </section>
              )}

              {/* Votação em andamento */}
              {data.currentVoting && data.currentVoting.status === 'open' && (
                <section
                  aria-label="Votação em andamento"
                  className="rounded-lg border-2 p-4"
                  style={{ borderColor: data.tenant.primaryColor }}
                >
                  <h3 className="mb-2 flex items-center gap-2 font-bold">
                    <Vote className="size-4" style={{ color: data.tenant.primaryColor }} aria-hidden />
                    Votação em andamento
                  </h3>
                  <p className="text-sm font-semibold leading-snug">{data.currentVoting.question}</p>
                  <p className="mt-1 text-xs text-zinc-600">
                    {VOTING_MODE_LABEL[data.currentVoting.mode]} ·{' '}
                    {data.currentVoting.registeredCount} voto(s) registrados
                  </p>
                  {data.currentVoting.hidePartial && (
                    <p className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-500">
                      <EyeOff className="size-3.5" aria-hidden /> Parcial oculto a pedido da mesa
                    </p>
                  )}
                </section>
              )}

              {/* Votações encerradas */}
              <section aria-label="Votações encerradas" className="rounded-lg border border-zinc-200 p-4">
                <h3 className="mb-3 flex items-center gap-2 font-bold">
                  <CheckCircle2 className="size-4 text-zinc-500" aria-hidden />
                  Votações encerradas
                </h3>
                {data.lastResults.length === 0 ? (
                  <p className="text-sm text-zinc-500">Nenhuma votação encerrada nesta sessão.</p>
                ) : (
                  <ul className="max-h-80 space-y-3 overflow-y-auto custom-scroll pr-1">
                    {data.lastResults.map((v) => (
                      <li key={v.id} className="border-b border-zinc-100 pb-3 last:border-0 last:pb-0">
                        <p className="text-sm font-semibold leading-snug">{v.question}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <PublicResult status={v.resultStatus} />
                          {v.resultCounts && (
                            <span className="text-xs text-zinc-600 tabular-nums">
                              Sim {v.resultCounts.sim} · Não {v.resultCounts.nao} · Abst.{' '}
                              {v.resultCounts.abstencoes}
                            </span>
                          )}
                        </div>
                        {v.nominalDetail ? (
                          <ul className="mt-2 flex flex-wrap gap-1.5">
                            {v.nominalDetail.map((n) => (
                              <li
                                key={n.name}
                                className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pl-2 pr-0.5 text-xs"
                              >
                                <span className="font-medium">
                                  {n.name} <span className="text-zinc-500">({n.party})</span>:
                                </span>
                                <PublicVoteChip value={n.value} />
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-xs italic text-zinc-500">
                            Votação secreta — votos individuais preservados.
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </>
      ) : (
        <div className="py-4">
          <EmptyState
            icon={<Landmark />}
            title="Nenhuma sessão publicada"
            description="Assim que a próxima sessão for agendada ou aberta, as informações aparecerão aqui em tempo real."
          />
        </div>
      )}

      {/* Dados abertos */}
      <section
        aria-label="Dados abertos"
        className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4"
      >
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold">Dados abertos</h3>
          <p className="text-xs text-zinc-600">
            Acompanhe esta sessão por API pública (JSON) ou integre ao site oficial da Câmara.
          </p>
        </div>
        <Button
          size="sm"
          className="text-white"
          style={{ backgroundColor: data.tenant.primaryColor }}
          onClick={onOpenApi}
        >
          <ExternalLink className="size-3.5" /> Abrir JSON
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-zinc-300 text-zinc-700 hover:bg-zinc-100"
          onClick={() => {
            void navigator.clipboard
              .writeText(`${window.location.origin}/api/v1/public/live?tenant=${encodeURIComponent(slug)}`)
              .then(() => toast.success('Link copiado', { description: 'Endpoint público de dados abertos.' }))
          }}
        >
          <Copy className="size-3.5" /> Copiar link
        </Button>
      </section>

      <p className="text-center text-[11px] leading-relaxed text-zinc-500">
        Dados públicos disponibilizados nos termos da Lei nº 12.527/2011 (LAI) e tratados conforme a LGPD (Lei
        nº 13.709/2018). Atualização automática a cada 15 segundos.
        <br />
        Última atualização: {new Date(dataUpdatedAt).toLocaleTimeString('pt-BR')} · edocBR Plenário.
      </p>
    </div>
  )
}

// ─── Tab: Pesquisa de Matérias ──────────────────────────────────────────────

function MatterDetailSheet({ matterId, slug, onClose }: { matterId: string; slug: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['public-matter', matterId],
    queryFn: () => api.publicMatterDetail(matterId, slug),
  })

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto custom-scroll sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="pr-6">
            {isLoading ? 'Carregando matéria…' : data ? fmtMatterLabel(data.matter.type, data.matter.number, data.matter.year) : 'Matéria'}
          </SheetTitle>
        </SheetHeader>
        {isLoading || !data ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : (
          <div className="mt-4 space-y-5 text-sm text-zinc-700">
            <section>
              <h4 className="mb-1 text-xs font-bold uppercase tracking-widest text-zinc-500">Ementa</h4>
              <p className="leading-relaxed">{data.matter.ementa}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>
                  <dt className="inline font-semibold">Tipo: </dt>
                  <dd className="inline">{MATTER_TYPE_LABEL[data.matter.type]}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Situação: </dt>
                  <dd className="inline">{MATTER_STATUS_LABEL[data.matter.status]}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Regime: </dt>
                  <dd className="inline">{data.matter.regime === 'urgencia' ? 'Urgência' : 'Ordinário'}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Apresentada em: </dt>
                  <dd className="inline">{fmtDateTime(data.matter.createdAt)}</dd>
                </div>
              </dl>
              <p className="mt-1.5 text-xs">
                <span className="font-semibold">Autores: </span>
                {data.matter.authors.join(', ') || '—'}
              </p>
            </section>

            <section>
              <h4 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-zinc-500">
                Tramitação ({data.proceedings.length})
              </h4>
              {data.proceedings.length === 0 ? (
                <p className="text-xs italic text-zinc-500">Nenhum andamento registrado.</p>
              ) : (
                <ol className="max-h-64 space-y-2 overflow-y-auto custom-scroll border-l-2 border-zinc-200 pl-4">
                  {data.proceedings.map((p) => (
                    <li key={p.seq} className="relative text-xs">
                      <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-zinc-400" aria-hidden />
                      <p className="font-semibold">
                        {p.seq}. {PROCEEDING_ACTION_LABEL[p.action] ?? p.action}
                        {p.toStatus ? ` — ${MATTER_STATUS_LABEL[p.toStatus as keyof typeof MATTER_STATUS_LABEL] ?? p.toStatus}` : ''}
                      </p>
                      <p className="text-zinc-500">{fmtDateTime(p.createdAt)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {data.lastVoting && (
              <section>
                <h4 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-zinc-500">Última votação</h4>
                <p className="font-semibold leading-snug">{data.lastVoting.question}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs">
                  <PublicResult status={data.lastVoting.resultStatus} />
                  {data.lastVoting.resultCounts && (
                    <span className="tabular-nums text-zinc-600">
                      Sim {data.lastVoting.resultCounts.sim} · Não {data.lastVoting.resultCounts.nao} · Abst.{' '}
                      {data.lastVoting.resultCounts.abstencoes}
                    </span>
                  )}
                </div>
                {data.lastVoting.nominalDetail ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {data.lastVoting.nominalDetail.map((n) => (
                      <li key={n.name} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pl-2 pr-0.5 text-xs">
                        <span className="font-medium">
                          {n.name} <span className="text-zinc-500">({n.party})</span>:
                        </span>
                        <PublicVoteChip value={n.value} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs italic text-zinc-500">Votação secreta — votos individuais preservados.</p>
                )}
              </section>
            )}

            <section>
              <h4 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-zinc-500">
                Versões ({data.versions.length})
              </h4>
              {data.versions.length === 0 ? (
                <p className="text-xs italic text-zinc-500">Nenhuma versão registrada.</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {data.versions.map((v) => (
                    <li key={v.version} className="flex items-baseline justify-between gap-2 border-b border-zinc-100 pb-1">
                      <span>
                        <strong className="tabular-nums">v{v.version}</strong> · {v.authorName}
                      </span>
                      <span className="text-zinc-500">{fmtDateTime(v.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function MattersSearchTab({ slug, primaryColor }: { slug: string; primaryColor: string }) {
  const [type, setType] = useState('all')
  const [year, setYear] = useState('')
  const [status, setStatus] = useState('all')
  const [author, setAuthor] = useState('')
  const [qInput, setQInput] = useState('')
  const q = useDebouncedValue(qInput, 450)
  const authorDebounced = useDebouncedValue(author, 450)
  const [cursor, setCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const currentYear = new Date().getFullYear()
  const years = useMemo(() => Array.from({ length: 6 }, (_, i) => currentYear - i), [currentYear])

  const filtersKey = JSON.stringify({ type, year, status, author: authorDebounced, q, cursor })
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['public-matters', filtersKey],
    queryFn: () =>
      api.publicMatters({
        tenant: slug,
        type: type === 'all' ? undefined : type,
        year: year || undefined,
        status: status === 'all' ? undefined : status,
        author: authorDebounced || undefined,
        q: q || undefined,
        limit: 15,
        cursor,
      }),
    placeholderData: (prev) => prev,
  })

  const matters = data?.matters ?? []
  const nextCursor = data?.nextCursor ?? null

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="grid gap-2 rounded-lg border border-zinc-200 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input
            value={qInput}
            onChange={(e) => {
              setQInput(e.target.value)
              setCursor(null)
            }}
            placeholder="Buscar na ementa…"
            className="border-zinc-300 pl-8"
            aria-label="Buscar por texto na ementa"
          />
        </div>
        <Select
          value={type}
          onValueChange={(v) => {
            setType(v)
            setCursor(null)
          }}
        >
          <SelectTrigger className="border-zinc-300" aria-label="Filtrar por tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {Object.entries(MATTER_TYPE_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={year || 'all'}
          onValueChange={(v) => {
            setYear(v === 'all' ? '' : v)
            setCursor(null)
          }}
        >
          <SelectTrigger className="border-zinc-300" aria-label="Filtrar por ano">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os anos</SelectItem>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v)
            setCursor(null)
          }}
        >
          <SelectTrigger className="border-zinc-300" aria-label="Filtrar por situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as situações</SelectItem>
            {Object.entries(MATTER_STATUS_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={author}
          onChange={(e) => {
            setAuthor(e.target.value)
            setCursor(null)
          }}
          placeholder="Autor (contém)…"
          className="border-zinc-300"
          aria-label="Filtrar por autor"
        />
      </div>

      {/* Resultados */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : matters.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title="Nenhuma matéria encontrada"
          description="Ajuste os filtros de tipo, ano, situação, autor ou termo de busca."
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-zinc-200">
            <table className="w-full text-sm">
              <caption className="sr-only">Resultado da pesquisa pública de matérias</caption>
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th scope="col" className="px-3 py-2 font-semibold">Matéria</th>
                  <th scope="col" className="hidden px-3 py-2 font-semibold md:table-cell">Ementa</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Situação</th>
                </tr>
              </thead>
              <tbody>
                {matters.map((m: MatterPublicView) => (
                  <tr
                    key={m.id}
                    onClick={() => setSelected(m.id)}
                    className="cursor-pointer border-b border-zinc-100 transition last:border-0 hover:bg-zinc-50"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setSelected(m.id)}
                  >
                    <td className="px-3 py-2.5">
                      <span className="font-bold" style={{ color: primaryColor }}>
                        {MATTER_TYPE_SHORT[m.type] ?? m.type} {m.number}/{m.year}
                      </span>
                      <span className="block text-xs text-zinc-500 md:hidden">
                        {m.ementa.slice(0, 60)}
                        {m.ementa.length > 60 ? '…' : ''}
                      </span>
                    </td>
                    <td className="hidden max-w-md px-3 py-2.5 md:table-cell">
                      <span className="line-clamp-2 text-zinc-600">{m.ementa}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className="border-zinc-300 text-[11px] text-zinc-700">
                        {MATTER_STATUS_LABEL[m.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500">
              {matters.length} matéria(s) exibida(s){nextCursor ? ' — há mais resultados' : ' — fim da lista'}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="border-zinc-300 text-zinc-700 hover:bg-zinc-100"
              disabled={!nextCursor || isFetching}
              onClick={() => nextCursor && setCursor(nextCursor)}
            >
              <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} /> Carregar mais
            </Button>
          </div>
        </>
      )}

      {selected && <MatterDetailSheet matterId={selected} slug={slug} onClose={() => setSelected(null)} />}
    </div>
  )
}

// ─── Tab: Sessões ───────────────────────────────────────────────────────────

function SessionDetailSheet({
  sessionId,
  slug,
  primaryColor,
  onClose,
}: {
  sessionId: string
  slug: string
  primaryColor: string
  onClose: () => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['public-session', sessionId],
    queryFn: () => api.publicSessionDetail(sessionId, slug),
  })

  const session: PublicSessionDetail | null = data ?? null

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto custom-scroll sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="pr-6">
            {isLoading || !session
              ? 'Carregando sessão…'
              : `${SESSION_TYPE_LABEL[session.session.type]} nº ${session.session.number}/${session.session.year}`}
          </SheetTitle>
        </SheetHeader>
        {isLoading || !session ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        ) : (
          <div className="mt-4 space-y-5 text-sm text-zinc-700">
            <p className="text-xs font-medium">{session.session.official ? 'Sessão oficial' : 'Sessão de ensaio'}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>
                <strong>Data:</strong> {fmtDateTime(session.session.scheduledAt)}
              </span>
              <span>
                <strong>Status:</strong> {SESSION_STATUS_LABEL[session.session.status]}
              </span>
              <span>
                <strong>Pauta:</strong> {session.session.agendaPublished ? 'publicada' : 'não publicada'}
              </span>
            </div>
            {session.transmissionLink && <a href={session.transmissionLink.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-medium underline" style={{ color: primaryColor }}><ExternalLink className="size-4" aria-hidden /> Abrir transmissão desta sessão</a>}
            {session.localReplay && <section aria-label="Replay local da sessão" className="space-y-2"><p className="font-medium">Replay local</p><video controls preload="metadata" className="w-full rounded" src={`/api/v1/public/sessions/${encodeURIComponent(sessionId)}/replay?tenant=${encodeURIComponent(slug)}`} aria-label="Replay desta sessão" /><p className="break-all text-[10px] text-zinc-500">SHA-256 do vídeo: {session.localReplay.replaySha256}</p></section>}
            {session.ata && <p className="break-all text-xs text-zinc-600">Ata publicada nº {session.ata.verificationCode} · SHA-256 do texto: {session.ata.contentSha256 ?? 'não registrado'}</p>}

            {/* Pauta publicada */}
            <section>
              <h4 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-zinc-500">
                Pauta {session.session.agendaPublished ? '' : '(não publicada)'}
              </h4>
              {session.agendaRevision && <p className="mb-2 text-xs text-zinc-600">Revisão {session.agendaRevision.number} · publicada em {fmtDateTime(session.agendaRevision.publishedAt)}{session.agendaRevision.justification ? ` · Motivo da alteração: ${session.agendaRevision.justification}` : ''}</p>}
              {session.agendaRevision?.noticeSha256 && <p className="mb-2 break-all text-xs text-zinc-600">
                <a className="font-semibold underline" href={`/api/v1/public/sessions/${sessionId}/notices?tenant=${encodeURIComponent(slug)}&revision=${session.agendaRevision.number}`} target="_blank" rel="noopener noreferrer">Ver convocação publicada</a>
                {' · SHA-256: '}{session.agendaRevision.noticeSha256}
              </p>}
              {session.agenda.length === 0 ? (
                <p className="text-xs italic text-zinc-500">
                  {session.session.agendaPublished ? 'Pauta vazia.' : 'A pauta é publicada quando a sessão é agendada.'}
                </p>
              ) : (
                <ol className="max-h-72 space-y-1.5 overflow-y-auto custom-scroll pr-1">
                  {session.agenda.map((item) => (
                    <li key={item.id} className="flex items-start gap-2 text-xs">
                      <span className="shrink-0 font-bold tabular-nums text-zinc-400">{item.order + 1}.</span>
                      <span className="min-w-0">
                        <span className="block leading-snug">{item.title}</span>
                        <span className="text-zinc-500">
                          {AGENDA_SECTION_LABEL[item.section]} · {AGENDA_STATUS_LABEL[item.status as AgendaItemStatus]}
                          {item.resultSummary ? ` — ${item.resultSummary}` : ''}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* Presença consolidada */}
            {session.attendance && (
              <section>
                <h4 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-zinc-500">
                  Presença consolidada ({session.attendance.presentCount}/{session.attendance.totalMembers})
                </h4>
                <ul className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto custom-scroll">
                  {session.attendance.present.map((m) => (
                    <li key={m.name} className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700">
                      {m.name} <span className="text-zinc-500">({m.party})</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Votações */}
            <section>
              <h4 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-zinc-500">
                Votações com resultado ({session.votings.length})
              </h4>
              {session.votings.length === 0 ? (
                <p className="text-xs italic text-zinc-500">Nenhuma votação encerrada.</p>
              ) : (
                <ul className="max-h-72 space-y-3 overflow-y-auto custom-scroll pr-1">
                  {session.votings.map((v) => (
                    <li key={v.id} className="border-b border-zinc-100 pb-3 last:border-0">
                      <p className="text-sm font-semibold leading-snug">{v.question}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <PublicResult status={v.resultStatus} />
                        <span className="text-zinc-500">{VOTING_MODE_LABEL[v.mode]}</span>
                        {v.resultCounts && (
                          <span className="tabular-nums text-zinc-600">
                            Sim {v.resultCounts.sim} · Não {v.resultCounts.nao} · Abst. {v.resultCounts.abstencoes}
                          </span>
                        )}
                      </div>
                      {v.nominalDetail ? (
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {v.nominalDetail.map((n) => (
                            <li key={n.name} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pl-2 pr-0.5 text-xs">
                              <span className="font-medium">
                                {n.name} <span className="text-zinc-500">({n.party})</span>:
                              </span>
                              <PublicVoteChip value={n.value} />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs italic text-zinc-500">Votação secreta — votos individuais preservados.</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Discursos encerrados */}
            <section>
              <h4 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-zinc-500">
                Discursos encerrados ({session.speeches.length})
              </h4>
              {session.speeches.length === 0 ? (
                <p className="text-xs italic text-zinc-500">Nenhum discurso encerrado.</p>
              ) : (
                <ul className="max-h-60 space-y-1.5 overflow-y-auto custom-scroll pr-1 text-xs">
                  {session.speeches.map((s, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-2 border-b border-zinc-100 pb-1">
                      <span className="min-w-0">
                        <strong>{s.speakerName}</strong> · {SPEECH_KIND_LABEL[s.kind] ?? s.kind}
                        {s.subject ? ` — ${s.subject}` : ''}
                      </span>
                      <span className="shrink-0 tabular-nums text-zinc-500">{fmtDuration(s.durationSeconds)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {/* F22 — Ata assinada eletronicamente (sessão encerrada com ata
                publicada; sem ata publicada a seção não aparece). */}
            {session.session.status === 'closed' && (
              <AtaSignaturesSection
                sessionId={session.session.id}
                slug={slug}
                primaryColor={primaryColor}
              />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function SessionsTab({ slug, primaryColor }: { slug: string; primaryColor: string }) {
  const [selected, setSelected] = useState<string | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['public-sessions', slug],
    queryFn: () => api.publicSessions({ tenant: slug, limit: 100 }),
  })

  const sessions: PublicSessionSummary[] = data?.sessions ?? []
  const now = Date.now()
  const upcoming = sessions.filter(
    (s) => s.status === 'scheduled' && new Date(s.scheduledAt).getTime() >= now
  )
  const inProgress = sessions.filter((s) => ['check_in', 'open', 'suspended', 'resumed'].includes(s.status))
  const historic = sessions.filter(
    (s) => !upcoming.includes(s) && !inProgress.includes(s)
  )

  const badge = (s: PublicSessionSummary) => {
    if (inProgress.includes(s))
      return (
        <Badge className="bg-emerald-600 text-[11px] text-white">
          <span className="relative mr-1 flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-white" />
          </span>
          Em andamento
        </Badge>
      )
    if (upcoming.includes(s))
      return (
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[11px] text-amber-800">
          <CalendarClock className="size-3" /> Agendada
        </Badge>
      )
    if (s.status === 'cancelled')
      return (
        <Badge variant="outline" className="border-zinc-300 text-[11px] text-zinc-600">
          <XCircle className="size-3" /> Cancelada
        </Badge>
      )
    return (
      <Badge variant="outline" className="border-zinc-300 text-[11px] text-zinc-600">
        <CheckCircle2 className="size-3" /> Encerrada
      </Badge>
    )
  }

  const renderGroup = (title: string, list: PublicSessionSummary[], icon: React.ReactNode) =>
    list.length > 0 && (
      <section aria-label={title} className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-zinc-500">
          {icon} {title} ({list.length})
        </h4>
        <ul className="space-y-2">
          {list.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => setSelected(s.id)}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 p-3 text-left transition hover:border-zinc-400 hover:bg-zinc-50"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-bold" style={{ color: primaryColor }}>
                    {SESSION_TYPE_LABEL[s.type]} nº {s.number}/{s.year} · {s.official ? 'Oficial' : 'Ensaio'}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {fmtDateTime(s.scheduledAt)} · Pauta {s.agendaPublished ? 'publicada' : 'não publicada'}
                  </span>
                </span>
                {badge(s)}
              </button>
            </li>
          ))}
        </ul>
      </section>
    )

  return (
    <div className="space-y-5">
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState icon={<CalendarClock />} title="Nenhuma sessão publicada" description="Sessões aparecem aqui quando são agendadas." />
      ) : (
        <>
          {renderGroup('Em andamento', inProgress, <RadioLive />)}
          {renderGroup('Futuras', upcoming, <CalendarClock className="size-3.5" />)}
          {renderGroup('Históricas', historic, <ScrollText className="size-3.5" />)}
        </>
      )}
      {selected && (
        <SessionDetailSheet
          sessionId={selected}
          slug={slug}
          primaryColor={primaryColor}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function RadioLive() {
  return (
    <span className="relative flex size-3.5 items-center justify-center" aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-emerald-600" />
    </span>
  )
}

// ─── Tab: Dados Abertos ─────────────────────────────────────────────────────

const DATASETS: Array<{
  id: 'matters' | 'sessions' | 'attendance' | 'votes'
  title: string
  description: string
}> = [
  {
    id: 'matters',
    title: 'Matérias legislativas',
    description: 'Todas as matérias publicáveis: tipo, número, ementa, autores e situação.',
  },
  {
    id: 'sessions',
    title: 'Sessões e resultados',
    description: 'Lista de sessões com resultados agregados das votações encerradas.',
  },
  {
    id: 'attendance',
    title: 'Presença consolidada',
    description: 'Presença por parlamentar nas sessões encerradas (dado público do mandato).',
  },
  {
    id: 'votes',
    title: 'Votações (resultados)',
    description: 'Resultados por votação — votações secretas nunca expõem voto nominal.',
  },
]

function OpenDataTab({ slug, primaryColor }: { slug: string; primaryColor: string }) {
  const [downloading, setDownloading] = useState<string | null>(null)

  const downloadCsv = async (dataset: (typeof DATASETS)[number]['id']) => {
    setDownloading(`${dataset}-csv`)
    try {
      const csv = await api.fetchOpenDataCsv(dataset, slug)
      downloadBlob(`dados-abertos-${dataset}-${slug}.csv`, csv, 'text/csv')
      toast.success('CSV baixado', { description: `Dataset "${dataset}" (separador ";", BOM UTF-8).` })
    } catch {
      toast.error('Falha no download', { description: 'Verifique o console da API.' })
    } finally {
      setDownloading(null)
    }
  }

  const downloadJson = async (dataset: (typeof DATASETS)[number]['id']) => {
    setDownloading(`${dataset}-json`)
    try {
      const res = await fetch(api.openDataUrl(dataset, 'json', slug))
      const json = await res.text()
      downloadBlob(`dados-abertos-${dataset}-${slug}.json`, JSON.stringify(JSON.parse(json), null, 2), 'application/json')
      toast.success('JSON baixado', { description: `Dataset "${dataset}" com generatedAt e tenant.` })
    } catch {
      toast.error('Falha no download', { description: 'Verifique o console da API.' })
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">
        Conjuntos de dados públicos em formatos abertos (JSON e CSV) para reutilização por jornalistas, pesquisadores
        e sistemas integrados — LAI (Lei nº 12.527/2011) e LGPD (Lei nº 13.709/2018).
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {DATASETS.map((d) => (
          <article key={d.id} className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4">
            <div className="flex-1">
              <h4 className="flex items-center gap-2 text-sm font-bold">
                <Database className="size-4" style={{ color: primaryColor }} aria-hidden /> {d.title}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-zinc-600">{d.description}</p>
              <code className="mt-2 block truncate rounded bg-zinc-100 px-2 py-1 font-mono text-[10px] text-zinc-600">
                GET /api/v1/public/open-data?dataset={d.id}&amp;format=json&amp;tenant={slug}
              </code>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-zinc-300 text-zinc-700 hover:bg-zinc-100"
                onClick={() => void downloadJson(d.id)}
                disabled={downloading !== null}
              >
                <FileJson className="size-3.5" />
                {downloading === `${d.id}-json` ? <RefreshCw className="size-3.5 animate-spin" /> : null} Baixar JSON
              </Button>
              <Button
                size="sm"
                className="text-white"
                style={{ backgroundColor: primaryColor }}
                onClick={() => void downloadCsv(d.id)}
                disabled={downloading !== null}
              >
                <FileSpreadsheet className="size-3.5" />
                {downloading === `${d.id}-csv` ? <RefreshCw className="size-3.5 animate-spin" /> : null} Baixar CSV
              </Button>
            </div>
          </article>
        ))}
      </div>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4">
        <div>
          <h4 className="text-sm font-bold">Sitemap XML</h4>
          <p className="text-xs text-zinc-600">Índice de sessões e matérias para mecanismos de busca.</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-zinc-300 text-zinc-700 hover:bg-zinc-100"
          onClick={() =>
            window.open(
              `/api/v1/public/sitemap.xml?tenant=${encodeURIComponent(slug)}`,
              '_blank',
              'noopener,noreferrer'
            )
          }
        >
          <Download className="size-3.5" /> Abrir sitemap
        </Button>
      </section>
    </div>
  )
}

// ─── Tab: Publicações (Fase 11) ─────────────────────────────────────────────

/** Fetch público local — NUNCA envia x-actor-id (portal é anônimo). */
async function publicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body !== undefined) headers.set('Content-Type', 'application/json')
  const res = await fetch(path, { ...init, headers })
  const text = await res.text()
  const body: unknown = text ? JSON.parse(text) : null
  if (!res.ok) {
    const problem = (body ?? {}) as { title?: string; detail?: string }
    throw new Error(problem.detail || problem.title || `Falha na requisição (${res.status}).`)
  }
  return body as T
}

type PublicPublicationRow = {
  id: string
  numberLabel: string
  kind: string
  kindLabel: string
  title: string
  status: string
  publishedAt: string | null
  revokedAt: string | null
}

type PublicPublicationDetailRow = PublicPublicationRow & {
  contentMd: string
  verificationCode: string | null
  revokedReason: string | null
  createdAt: string
}

const PORTAL_PUBLICATION_KINDS: Array<{ value: string; label: string }> = [
  { value: 'ata_sessao', label: 'Ata de Sessão' },
  { value: 'decreto', label: 'Decreto' },
  { value: 'resolucao', label: 'Resolução' },
  { value: 'portaria', label: 'Portaria' },
  { value: 'edital', label: 'Edital' },
  { value: 'ata', label: 'Ata' },
]

// ─── Fase 19: verificação pública de autenticidade ──────────────────────────

type VerifyResultRow = PublicVerifyResult & { revokedAt?: string | null }

/** Selo resultante da verificação — cor + ÍCONE + texto (nunca só cor). */
function VerifySeal({ result }: { result: VerifyResultRow }) {
  if (result.status === 'integridade_invalida' || result.status === 'sem_hash') {
    return <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-rose-900">
      <p className="flex items-center gap-1.5 font-bold"><AlertTriangle className="size-4" aria-hidden />
        {result.status === 'sem_hash' ? 'Integridade não comprovada' : 'Integridade inválida'}</p>
      <p className="mt-1 text-sm">{result.title} · {result.tenantName}</p>
      <p className="mt-1 text-xs">O código identifica uma publicação, mas o conteúdo não possui hash publicado verificável ou diverge dele. Procure a Câmara antes de usar este documento.</p>
    </div>
  }
  if (result.status === 'valida') {
    return (
      <div
        role="status"
        className="rounded-lg border border-emerald-300 bg-emerald-50 p-3"
        aria-live="polite"
      >
        <p className="flex items-center gap-1.5 font-bold text-emerald-800">
          <ShieldCheck className="size-4 shrink-0" aria-hidden /> Documento autêntico
        </p>
        <p className="mt-1 text-sm font-medium text-emerald-900">{result.title}</p>
        <p className="mt-0.5 text-xs text-emerald-800">
          Publicado em {fmtDateTime(result.publishedAt)} · {result.tenantName}
        </p>
        <p className="mt-1 text-xs text-emerald-700">
          O código corresponde a uma publicação vigente do diário eletrônico desta Casa Legislativa.
        </p>
      </div>
    )
  }
  if (result.status === 'revogada') {
    return (
      <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3" aria-live="polite">
        <p className="flex items-center gap-1.5 font-bold text-amber-800">
          <AlertTriangle className="size-4 shrink-0" aria-hidden /> Publicação revogada
        </p>
        <p className="mt-1 text-sm font-medium text-amber-900">{result.title}</p>
        <p className="mt-0.5 text-xs text-amber-800">
          {result.tenantName} · publicada em {fmtDateTime(result.publishedAt)}
          {result.revokedAt ? ` e revogada em ${fmtDateTime(result.revokedAt)}` : ''}
        </p>
        <p className="mt-1 text-xs text-amber-800">
          O código é válido, mas o documento foi formalmente revogado — consulte o motivo no
          detalhe da publicação.
        </p>
      </div>
    )
  }
  return (
    <div role="status" className="rounded-lg border border-zinc-300 bg-zinc-50 p-3" aria-live="polite">
      <p className="flex items-center gap-1.5 font-bold text-zinc-700">
        <XCircle className="size-4 shrink-0" aria-hidden /> Código não encontrado
      </p>
      <p className="mt-1 text-xs text-zinc-600">
        Nenhuma publicação oficial corresponde a este código de verificação. Confira a digitação —
        se persistir, o documento pode não ter sido emitido por este diário eletrônico.
      </p>
    </div>
  )
}

/** Caixa do código de verificação + consulta pública /api/v1/public/verify. */
function VerifyAuthenticityBox({ code, primaryColor }: { code: string | null; primaryColor: string }) {
  const [result, setResult] = useState<VerifyResultRow | null>(null)

  const verify = useMutation({
    mutationFn: () =>
      publicFetch<VerifyResultRow>(`/api/v1/public/verify?code=${encodeURIComponent(code ?? '')}`),
    onSuccess: (r) => setResult(r),
    onError: (err) =>
      toast.error('Não foi possível verificar o código', { description: err.message }),
  })

  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Código de verificação
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <p className="font-mono text-lg font-bold tracking-[0.35em] text-zinc-900">{code ?? '—'}</p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 border-zinc-300 text-zinc-700 hover:bg-zinc-100"
          onClick={() => verify.mutate()}
          disabled={!code || verify.isPending}
          aria-label="Verificar autenticidade da publicação pelo código"
        >
          {verify.isPending ? (
            <RefreshCw className="size-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="size-3.5" style={{ color: primaryColor }} />
          )}
          Verificar autenticidade
        </Button>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Verifique a autenticidade deste documento: a consulta pública confirma se o código
        corresponde a uma publicação válida do diário eletrônico.
      </p>
      {result && (
        <div className="mt-2">
          <VerifySeal result={result} />
        </div>
      )}
    </div>
  )
}

// ─── F22: assinaturas eletrônicas da ata (público — ADR-023) ────────────────

/** Campo público de verificação por código de assinatura (rate limited). */
function SignatureVerifyBox({ primaryColor }: { primaryColor: string }) {
  const [code, setCode] = useState('')
  const [result, setResult] = useState<SignatureVerificationView | null>(null)

  const verify = useMutation({
    mutationFn: () => signaturesApi.verifySignature(code),
    onSuccess: (r) => setResult(r),
    onError: () => setResult(null),
  })

  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Verificar assinatura eletrônica
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Código de 16 caracteres"
          className="h-9 w-full max-w-[16rem] border-zinc-300 bg-white font-mono text-sm uppercase tracking-wider text-zinc-900 placeholder:font-sans placeholder:normal-case placeholder:tracking-normal"
          maxLength={16}
          aria-label="Código de assinatura eletrônica para verificação"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-9 border-zinc-300 text-zinc-700 hover:bg-zinc-100"
          onClick={() => verify.mutate()}
          disabled={code.trim().length < 6 || verify.isPending}
        >
          {verify.isPending ? (
            <RefreshCw className="size-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="size-3.5" style={{ color: primaryColor }} />
          )}
          Verificar autenticidade
        </Button>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Digite o código impresso na ata assinada — a consulta pública recompute a cadeia de hash
        e confirma quem assinou, quando e se o documento é íntegro (limite: 30/min).
      </p>
      {result && (
        <div className="mt-2" role="status" aria-live="polite">
          {result.valid ? (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3">
              <p className="flex items-center gap-1.5 font-bold text-emerald-800">
                <ShieldCheck className="size-4 shrink-0" aria-hidden /> Assinatura autêntica
              </p>
              <p className="mt-1 text-sm font-medium text-emerald-900">{result.signatoryName}</p>
              <p className="mt-0.5 text-xs text-emerald-800">
                {result.document} · assinada em {result.signedAt ? fmtDateTime(result.signedAt) : '—'}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
              <p className="flex items-center gap-1.5 font-bold text-rose-800">
                <XCircle className="size-4 shrink-0" aria-hidden /> Assinatura não confirmada
              </p>
              <p className="mt-0.5 text-xs text-rose-700">
                O código não corresponde a uma assinatura válida — confira a digitação ou consulte
                a Casa Legislativa.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Ata da sessão encerrada com assinaturas eletrônicas: conteúdo público,
 * "Assinado eletronicamente por" (nome + horário + código), selo de
 * integridade da cadeia e verificação por código. Sem ata publicada →
 * nada é exibido (404 silencioso via publicFetch local).
 */
function AtaSignaturesSection({
  sessionId,
  slug,
  primaryColor,
}: {
  sessionId: string
  slug: string
  primaryColor: string
}) {
  const ataQ = useQuery({
    queryKey: ['public-ata', sessionId, slug],
    queryFn: () =>
      publicFetch<PublicAtaView>(
        `/api/v1/public/documents/ata/${sessionId}?tenant=${encodeURIComponent(slug)}`
      ),
    retry: false,
  })
  const ata = ataQ.data ?? null

  if (ataQ.isLoading) {
    return <Skeleton className="h-32 w-full rounded-lg" />
  }
  if (ataQ.isError || !ata) return null

  return (
    <section aria-label="Ata da sessão e assinaturas eletrônicas">
      <h4 className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
        <ScrollText className="size-3.5" style={{ color: primaryColor }} aria-hidden />
        Ata publicada
        {ata.chainValid ? (
          <Badge className="gap-1 border border-emerald-200 bg-emerald-50 text-emerald-700">
            <ShieldCheck className="size-3" aria-hidden /> Cadeia verificada
          </Badge>
        ) : (
          <Badge className="gap-1 border border-amber-200 bg-amber-50 text-amber-700">
            <AlertTriangle className="size-3" aria-hidden /> Integridade não confere
          </Badge>
        )}
      </h4>
      {ata.publishedAt && (
        <p className="text-xs text-zinc-500">Publicada em {fmtDateTime(ata.publishedAt)}</p>
      )}
      <pre className="mt-2 max-h-44 overflow-y-auto custom-scroll whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-sans text-xs leading-relaxed">
        {ata.contentMd}
      </pre>
      <p className="mt-1 font-mono text-[10px] tracking-wide text-zinc-400 break-all">
        sha256: {ata.docHash}
      </p>

      <h5 className="mb-1.5 mt-4 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-zinc-500">
        <PenLine className="size-3.5" style={{ color: primaryColor }} aria-hidden />
        Assinado eletronicamente por ({ata.signatures.length})
      </h5>
      {ata.signatures.length === 0 ? (
        <p className="text-xs italic text-zinc-500">
          Nenhuma assinatura registrada até o momento.
        </p>
      ) : (
        <ul className="max-h-56 space-y-1.5 overflow-y-auto custom-scroll pr-1">
          {ata.signatures.map((s, i) => (
            <li
              key={`${s.signatureCode}-${i}`}
              className="flex items-start justify-between gap-2 rounded-lg border border-zinc-100 bg-white px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <p className="font-semibold text-zinc-800">{s.signatoryName}</p>
                <p className="text-zinc-500">{fmtDateTime(s.signedAt)}</p>
              </div>
              <p className="shrink-0 font-mono font-semibold tracking-wider text-zinc-700">
                {s.signatureCode}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-[11px] italic text-zinc-500">
        A assinatura eletrônica atesta a presença na sessão — o voto secreto permanece sigiloso
        (ADR-023).
      </p>

      <div className="mt-3">
        <SignatureVerifyBox primaryColor={primaryColor} />
      </div>
    </section>
  )
}

function PublicationDetailDialog({
  publicationId,
  slug,
  primaryColor,
  onClose,
}: {
  publicationId: string
  slug: string
  primaryColor: string
  onClose: () => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['public-publication-detail', publicationId],
    queryFn: () =>
      publicFetch<{ publication: PublicPublicationDetailRow }>(
        `/api/v1/public/publications/${publicationId}?tenant=${encodeURIComponent(slug)}`
      ),
  })
  const p = data?.publication ?? null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto custom-scroll bg-white text-zinc-900 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            <Newspaper className="size-5" style={{ color: primaryColor }} aria-hidden />
            <span className="font-mono">{p?.numberLabel ?? '—'}</span>
            <span className="text-zinc-400">·</span>
            <span>{p?.kindLabel ?? 'Publicação'}</span>
            {p?.status === 'revoked' && (
              <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-700">
                <XCircle className="size-3" /> Revogada
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-sm font-semibold text-zinc-800">
            {isLoading ? 'Carregando publicação…' : (p?.title ?? '')}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !p ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        ) : (
          <div className="space-y-4 text-sm text-zinc-700">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
              {p.publishedAt && <span>Publicada em {fmtDateTime(p.publishedAt)}</span>}
              {p.revokedAt && <span>Revogada em {fmtDateTime(p.revokedAt)}</span>}
            </div>

            {p.status === 'revoked' && (
              <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                <p className="font-semibold text-rose-800">Publicação revogada</p>
                <p className="mt-1 whitespace-pre-wrap text-rose-700">{p.revokedReason ?? '—'}</p>
              </div>
            )}

            <section aria-label="Conteúdo integral da publicação">
              {p.contentMd.trim() ? (
                <pre className="whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-sans text-sm leading-relaxed">
                  {p.contentMd}
                </pre>
              ) : (
                <p className="text-sm italic text-zinc-500">Publicação sem conteúdo textual.</p>
              )}
            </section>

            <VerifyAuthenticityBox code={p.verificationCode} primaryColor={primaryColor} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PublicationsPortalTab({ slug, primaryColor }: { slug: string; primaryColor: string }) {
  const [year, setYear] = useState('')
  const [kind, setKind] = useState('all')
  const [qInput, setQInput] = useState('')
  const q = useDebouncedValue(qInput, 450)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)

  // Troca de filtro volta para a 1ª página (reset derivado no render).
  const [prevFilters, setPrevFilters] = useState({ year, kind, q })
  if (prevFilters.year !== year || prevFilters.kind !== kind || prevFilters.q !== q) {
    setPrevFilters({ year, kind, q })
    setPage(1)
  }

  const filtersKey = JSON.stringify({ slug, year, kind, q, page })
  const { data, isLoading } = useQuery({
    queryKey: ['public-publications', filtersKey],
    queryFn: () => {
      const params = new URLSearchParams({ tenant: slug, page: String(page), pageSize: '20' })
      if (/^\d{4}$/.test(year.trim())) params.set('year', year.trim())
      if (kind !== 'all') params.set('kind', kind)
      if (q.trim()) params.set('q', q.trim())
      return publicFetch<{
        publications: PublicPublicationRow[]
        page: number
        pageSize: number
        total: number
      }>(`/api/v1/public/publications?${params.toString()}`)
    },
  })

  const publications = data?.publications ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / (data?.pageSize ?? 20)))

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">
        Diário eletrônico oficial: atas de sessão, decretos, resoluções, portarias e editais com
        código de verificação. Publicações revogadas permanecem consultáveis com o motivo.
      </p>

      {/* Filtros */}
      <div className="grid gap-2 rounded-lg border border-zinc-200 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Buscar por título…"
            className="border-zinc-300 pl-8"
            aria-label="Buscar publicações por título"
          />
        </div>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="border-zinc-300" aria-label="Filtrar por tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {PORTAL_PUBLICATION_KINDS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          inputMode="numeric"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="Ano (ex.: 2026)"
          min={1990}
          max={2100}
          className="border-zinc-300"
          aria-label="Filtrar por ano"
        />
        <p className="self-center text-xs text-zinc-500">
          {isLoading ? 'Consultando…' : `${total} publicação(ões) no diário`}
        </p>
      </div>

      {/* Resultados */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : publications.length === 0 ? (
        <EmptyState
          icon={<Newspaper />}
          title="Nenhuma publicação encontrada"
          description="Ajuste o termo de busca, o tipo ou o ano."
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-zinc-200">
            <table className="w-full text-sm">
              <caption className="sr-only">Publicações do diário eletrônico</caption>
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th scope="col" className="px-3 py-2 font-semibold">Nº</th>
                  <th scope="col" className="hidden px-3 py-2 font-semibold sm:table-cell">Tipo</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Título</th>
                  <th scope="col" className="hidden px-3 py-2 font-semibold md:table-cell">Publicada em</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Situação</th>
                </tr>
              </thead>
              <tbody>
                {publications.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => setSelected(p.id)}
                    className="cursor-pointer border-b border-zinc-100 transition last:border-0 hover:bg-zinc-50"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setSelected(p.id)}
                  >
                    <td className="px-3 py-2.5 font-mono text-xs font-bold" style={{ color: primaryColor }}>
                      {p.numberLabel}
                    </td>
                    <td className="hidden px-3 py-2.5 sm:table-cell">
                      <Badge variant="outline" className="border-zinc-300 text-[11px] text-zinc-600">
                        {p.kindLabel}
                      </Badge>
                    </td>
                    <td className="max-w-xs px-3 py-2.5">
                      <span className="line-clamp-2 text-zinc-700">{p.title}</span>
                    </td>
                    <td className="hidden px-3 py-2.5 text-xs text-zinc-500 md:table-cell">
                      {p.publishedAt ? fmtDateTime(p.publishedAt) : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      {p.status === 'revoked' ? (
                        <Badge
                          variant="outline"
                          className="border-rose-300 bg-rose-50 text-[11px] text-rose-700"
                          title="Publicação revogada — abra o detalhe para ver o motivo."
                        >
                          <XCircle className="size-3" /> Revogada
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-[11px] text-emerald-700">
                          <CheckCircle2 className="size-3" /> Publicada
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500">
              Página {data?.page ?? 1} de {totalPages} · {total} no total
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-zinc-300 text-zinc-700 hover:bg-zinc-100"
                disabled={page <= 1 || isLoading}
                onClick={() => setPage((v) => Math.max(1, v - 1))}
              >
                Anterior
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-zinc-300 text-zinc-700 hover:bg-zinc-100"
                disabled={page >= totalPages || isLoading}
                onClick={() => setPage((v) => v + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        </>
      )}

      {selected && (
        <PublicationDetailDialog
          publicationId={selected}
          slug={slug}
          primaryColor={primaryColor}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

// ─── Tab: Audiências (Fase 11) ──────────────────────────────────────────────

type PublicHearingRow = {
  id: string
  title: string
  subject: string
  matterId: string | null
  scheduledAt: string
  location: string | null
  status: string
  statusLabel: string
  questionsOpen: boolean
  answeredCount: number
}

type PublicHearingQuestionRow = {
  id: string
  authorName: string
  district: string | null
  question: string
  status: string
  statusLabel: string
  answer: string | null
  answeredAt: string | null
  createdAt: string
}

type PublicHearingDetailRow = PublicHearingRow & { questions: PublicHearingQuestionRow[] }

/** Formulário de participação popular (sem autenticação). */
function CitizenQuestionForm({
  hearing,
  slug,
  primaryColor,
}: {
  hearing: PublicHearingDetailRow
  slug: string
  primaryColor: string
}) {
  const [authorName, setAuthorName] = useState('')
  const [district, setDistrict] = useState('')
  const [authorEmail, setAuthorEmail] = useState('')
  const [question, setQuestion] = useState('')

  const submit = useMutation({
    mutationFn: () =>
      publicFetch<{ ok: boolean; message: string }>(
        `/api/v1/public/hearings/${hearing.id}/questions?tenant=${encodeURIComponent(slug)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            authorName: authorName.trim(),
            district: district.trim() || undefined,
            authorEmail: authorEmail.trim() || undefined,
            question: question.trim(),
          }),
        }
      ),
    onSuccess: () => {
      toast.success('Pergunta enviada para moderação', {
        description: 'Ela aparecerá no portal após aprovação pela equipe da Câmara.',
      })
      setAuthorName('')
      setDistrict('')
      setAuthorEmail('')
      setQuestion('')
    },
    onError: (err) =>
      toast.error('Não foi possível enviar a pergunta', { description: err.message }),
  })

  const nameValid = authorName.trim().length >= 2
  const questionValid = question.trim().length >= 10

  return (
    <section
      aria-label="Envie sua pergunta"
      className="rounded-lg border border-zinc-200 p-4"
    >
      <h4 className="flex items-center gap-2 text-sm font-bold">
        <MessageCircleQuestion className="size-4" style={{ color: primaryColor }} aria-hidden />
        Envie sua pergunta
      </h4>
      <p className="mt-1 text-xs leading-relaxed text-zinc-600">
        Sua pergunta passa por moderação antes de aparecer publicamente. Nome e bairro são exibidos
        após a aprovação; o e-mail <strong>nunca</strong> é publicado.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="citizen-name" className="text-zinc-700">
            Nome *
          </Label>
          <Input
            id="citizen-name"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            placeholder="Seu nome"
            className="border-zinc-300"
            maxLength={120}
            aria-invalid={!nameValid && authorName.length > 0}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="citizen-district" className="text-zinc-700">
            Bairro
          </Label>
          <Input
            id="citizen-district"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            placeholder="Seu bairro"
            className="border-zinc-300"
            maxLength={80}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="citizen-email" className="text-zinc-700">
            E-mail
          </Label>
          <Input
            id="citizen-email"
            type="email"
            value={authorEmail}
            onChange={(e) => setAuthorEmail(e.target.value)}
            placeholder="contato@exemplo.com"
            className="border-zinc-300"
            aria-describedby="citizen-email-hint"
          />
          <p id="citizen-email-hint" className="text-[11px] text-zinc-500">
            Opcional — não será exibido.
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-1">
        <Label htmlFor="citizen-question" className="text-zinc-700">
          Pergunta *
        </Label>
        <Textarea
          id="citizen-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Escreva sua pergunta aos parlamentares (mín. 10 caracteres)…"
          className="min-h-24 border-zinc-300"
          maxLength={1000}
          aria-invalid={!questionValid && question.length > 0}
          aria-describedby="citizen-question-count"
        />
        <p id="citizen-question-count" className="text-right text-[11px] text-zinc-500">
          {question.length}/1000 (mín. 10)
        </p>
      </div>
      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          className="text-white"
          style={{ backgroundColor: primaryColor }}
          onClick={() => submit.mutate()}
          disabled={submit.isPending || !nameValid || !questionValid}
        >
          {submit.isPending ? (
            <RefreshCw className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          Enviar pergunta
        </Button>
      </div>
    </section>
  )
}

function HearingDetailDialog({
  hearingId,
  slug,
  primaryColor,
  onClose,
}: {
  hearingId: string
  slug: string
  primaryColor: string
  onClose: () => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['public-hearing-detail', hearingId],
    queryFn: () =>
      publicFetch<{ hearing: PublicHearingDetailRow }>(
        `/api/v1/public/hearings/${hearingId}?tenant=${encodeURIComponent(slug)}`
      ),
  })
  const hearing = data?.hearing ?? null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto custom-scroll bg-white text-zinc-900 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-6">{hearing?.title ?? 'Audiência pública'}</DialogTitle>
          <DialogDescription>
            {hearing
              ? `${fmtDateTime(hearing.scheduledAt)}${hearing.location ? ` · ${hearing.location}` : ''}`
              : 'Carregando…'}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !hearing ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        ) : (
          <div className="space-y-5 text-sm text-zinc-700">
            <p className="leading-relaxed">{hearing.subject}</p>

            {/* Perguntas aprovadas / respondidas */}
            <section aria-label="Perguntas aprovadas">
              <h4 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-zinc-500">
                Perguntas aprovadas ({hearing.questions.length}) · {hearing.answeredCount}{' '}
                respondida(s)
              </h4>
              {hearing.questions.length === 0 ? (
                <p className="text-xs italic text-zinc-500">
                  Nenhuma pergunta aprovada ainda — seja o primeiro a participar!
                </p>
              ) : (
                <ul className="max-h-72 space-y-3 overflow-y-auto custom-scroll pr-1">
                  {hearing.questions.map((q) => (
                    <li key={q.id} className="rounded-lg border border-zinc-200 p-3">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{q.question}</p>
                      <p className="mt-1.5 text-xs text-zinc-500">
                        — {q.authorName}
                        {q.district ? ` (${q.district})` : ''} · {fmtDateTime(q.createdAt)}
                      </p>
                      {q.status === 'answered' && q.answer && (
                        <div className="mt-2 rounded-md border-l-2 bg-zinc-50 p-2.5" style={{ borderColor: primaryColor }}>
                          <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
                            Resposta oficial {q.answeredAt ? `· ${fmtDateTime(q.answeredAt)}` : ''}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{q.answer}</p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Participação popular */}
            {(hearing.status === 'scheduled' || hearing.status === 'open') && hearing.questionsOpen ? (
              <CitizenQuestionForm hearing={hearing} slug={slug} primaryColor={primaryColor} />
            ) : (
              <p
                role="note"
                className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3 text-sm text-zinc-600"
              >
                Perguntas encerradas para esta audiência.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function HearingsPortalTab({ slug, primaryColor }: { slug: string; primaryColor: string }) {
  const [selected, setSelected] = useState<string | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['public-hearings', slug],
    queryFn: () =>
      publicFetch<{ hearings: PublicHearingRow[] }>(
        `/api/v1/public/hearings?tenant=${encodeURIComponent(slug)}`
      ),
  })

  const hearings = data?.hearings ?? []
  const inProgress = hearings.filter((h) => h.status === 'open')
  const upcoming = hearings.filter((h) => h.status === 'scheduled')
  const closed = hearings.filter((h) => h.status === 'closed')

  const renderGroup = (title: string, list: PublicHearingRow[], badge: (h: PublicHearingRow) => React.ReactNode) =>
    list.length > 0 && (
      <section aria-label={title} className="space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500">
          {title} ({list.length})
        </h4>
        <ul className="space-y-2">
          {list.map((h) => (
            <li key={h.id}>
              <button
                onClick={() => setSelected(h.id)}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 p-3 text-left transition hover:border-zinc-400 hover:bg-zinc-50"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-bold" style={{ color: primaryColor }}>
                    {h.title}
                  </span>
                  <span className="block max-w-xl truncate text-xs text-zinc-600">{h.subject}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-zinc-500">
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="size-3" aria-hidden /> {fmtDateTime(h.scheduledAt)}
                    </span>
                    {h.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" aria-hidden /> {h.location}
                      </span>
                    )}
                    <span>{h.answeredCount} respondida(s)</span>
                  </span>
                </span>
                {badge(h)}
              </button>
            </li>
          ))}
        </ul>
      </section>
    )

  const liveBadge = () => (
    <Badge className="bg-amber-500 text-[11px] text-white">
      <span className="relative mr-1 flex size-1.5" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
        <span className="relative inline-flex size-1.5 rounded-full bg-white" />
      </span>
      AO VIVO
    </Badge>
  )
  const upcomingBadge = (h: PublicHearingRow) =>
    h.questionsOpen ? (
      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[11px] text-amber-800">
        Aceita perguntas
      </Badge>
    ) : (
      <Badge variant="outline" className="border-zinc-300 text-[11px] text-zinc-600">
        Agendada
      </Badge>
    )
  const closedBadge = () => (
    <Badge variant="outline" className="border-zinc-300 text-[11px] text-zinc-500">
      <CheckCircle2 className="size-3" /> Encerrada
    </Badge>
  )

  return (
    <div className="space-y-5">
      <p className="text-sm text-zinc-600">
        Audiências públicas da Casa Legislativa: acompanhe as perguntas dos cidadãos aprovadas pela
        moderação e envie a sua — sem cadastro.
      </p>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : hearings.length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title="Nenhuma audiência pública"
          description="As audiências aparecem aqui quando são agendadas pela Casa Legislativa."
        />
      ) : (
        <>
          {renderGroup('Em andamento', inProgress, liveBadge)}
          {renderGroup('Agendadas', upcoming, upcomingBadge)}
          {renderGroup('Encerradas', closed, closedBadge)}
        </>
      )}

      {selected && (
        <HearingDetailDialog
          hearingId={selected}
          slug={slug}
          primaryColor={primaryColor}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

// ─── Tab: Acompanhar (Fase 19 — assinatura do cidadão) ──────────────────────

type SubscribeResponse = {
  status: 'pending' | 'confirmed'
  confirmationDelivery?: 'queued' | 'awaiting_configuration'
  message: string
  subscription: {
    id: string
    email: string
    targetKind: SubscriptionTargetKind
    targetId: string
    targetLabel: string | null
    confirmedAt: string | null
    createdAt: string
  }
}

type SubscribeBanner = {
  tone: 'success' | 'info'
  title: string
  text: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const truncate = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s

/** Formulário público de assinatura (double opt-in) — sem autenticação. */
function SubscribeTab({ slug, primaryColor }: { slug: string; primaryColor: string }) {
  const [email, setEmail] = useState('')
  const [kind, setKind] = useState<SubscriptionTargetKind>('matter')
  const [targetId, setTargetId] = useState('')
  const [banner, setBanner] = useState<SubscribeBanner | null>(null)

  // Troca de tipo de alvo limpa a escolha (reset derivado no render).
  const [prevKind, setPrevKind] = useState(kind)
  if (prevKind !== kind) {
    setPrevKind(kind)
    setTargetId('')
  }
  // Qualquer edição do formulário encerra o banner de resultado anterior.
  const formKey = `${email}|${kind}|${targetId}`
  const [prevFormKey, setPrevFormKey] = useState(formKey)
  if (prevFormKey !== formKey) {
    setPrevFormKey(formKey)
    setBanner(null)
  }

  // Alvos carregados das MESMAS fontes públicas das outras abas (cache
  // compartilhada pelas query keys).
  const mattersQ = useQuery({
    queryKey: ['public-sub-matters', slug],
    queryFn: () => api.publicMatters({ tenant: slug, limit: 100 }),
    enabled: kind === 'matter',
  })
  const sessionsQ = useQuery({
    queryKey: ['public-sessions', slug],
    queryFn: () => api.publicSessions({ tenant: slug, limit: 100 }),
    enabled: kind === 'session',
  })
  const hearingsQ = useQuery({
    queryKey: ['public-hearings', slug],
    queryFn: () =>
      publicFetch<{ hearings: PublicHearingRow[] }>(
        `/api/v1/public/hearings?tenant=${encodeURIComponent(slug)}`
      ),
    enabled: kind === 'hearing',
  })

  const subscribe = useMutation({
    mutationFn: async (): Promise<{ httpStatus: number; data: SubscribeResponse }> => {
      const res = await fetch(
        `/api/v1/public/subscriptions?tenant=${encodeURIComponent(slug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            targetKind: kind,
            targetId,
          }),
        }
      )
      const body: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        const problem = (body ?? {}) as { title?: string; detail?: string }
        throw new Error(problem.detail || problem.title || `Falha na requisição (${res.status}).`)
      }
      return { httpStatus: res.status, data: body as SubscribeResponse }
    },
    onSuccess: ({ httpStatus, data }) => {
      if (data.status === 'confirmed') {
        setBanner({
          tone: 'info',
          title: 'Assinatura já confirmada',
          text: `${data.message} Alvo: ${data.subscription.targetLabel ?? '—'}.`,
        })
        toast.info('Assinatura já confirmada', {
          description: 'Você já acompanha este item — nenhuma ação necessária.',
        })
        return
      }
      if (httpStatus === 201) {
        const queued = data.confirmationDelivery === 'queued'
        setBanner({
          tone: 'success',
          title: queued ? 'Assinatura registrada; aguarde o e-mail de confirmação.' : 'Assinatura registrada; confirmação pendente.',
          text: `${data.message} A dupla confirmação garante que ninguém cadastre e-mails de terceiros.`,
        })
        toast.success('Assinatura registrada', {
          description: data.message,
        })
      } else {
        setBanner({
          tone: 'info',
          title: 'Assinatura já registrada — aguardando confirmação',
          text: data.message,
        })
        toast.info('Aguardando confirmação', {
          description: data.message,
        })
      }
    },
    onError: (err) =>
      toast.error('Não foi possível registrar a assinatura', { description: err.message }),
  })

  const emailValid = EMAIL_RE.test(email.trim())
  const optionsLoading =
    (kind === 'matter' && mattersQ.isLoading) ||
    (kind === 'session' && sessionsQ.isLoading) ||
    (kind === 'hearing' && hearingsQ.isLoading)

  const targetLabel = () => {
    if (kind === 'matter') {
      const m = mattersQ.data?.matters ?? []
      return `${m.length} matéria(s)`;
    }
    if (kind === 'session') {
      const s = sessionsQ.data?.sessions ?? []
      return `${s.length} sessão(ões)`
    }
    const h = hearingsQ.data?.hearings ?? []
    return `${h.length} audiência(s)`
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">
        Acompanhe o que importa para você: receba por e-mail as novidades de matérias, sessões
        deliberativas e audiências públicas — com dupla confirmação e sem cadastro.
      </p>

      {banner && (
        <div
          role="status"
          aria-live="polite"
          className={
            banner.tone === 'success'
              ? 'rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-900'
              : 'rounded-lg border border-zinc-300 bg-zinc-50 p-3 text-zinc-800'
          }
        >
          <p className="flex items-start gap-1.5 font-bold">
            {banner.tone === 'success' ? (
              <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            {banner.title}
          </p>
          <p className="mt-1 pl-5 text-sm">{banner.text}</p>
        </div>
      )}

      {/* Formulário */}
      <section aria-label="Formulário de acompanhamento por e-mail" className="rounded-lg border border-zinc-200 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="subscribe-email" className="text-zinc-700">
              Seu e-mail *
            </Label>
            <Input
              id="subscribe-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contato@exemplo.com"
              className="border-zinc-300"
              maxLength={254}
              autoComplete="email"
              aria-invalid={!emailValid && email.length > 0}
              aria-describedby="subscribe-email-hint"
            />
            <p id="subscribe-email-hint" className="text-[11px] text-zinc-500">
              Usado apenas para o acompanhamento (LGPD) — nunca publicado.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="subscribe-kind" className="text-zinc-700">
              O que deseja acompanhar? *
            </Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as SubscriptionTargetKind)}
            >
              <SelectTrigger id="subscribe-kind" className="border-zinc-300" aria-label="Tipo de alvo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(SUBSCRIPTION_TARGET_LABEL) as Array<[SubscriptionTargetKind, string]>).map(
                  ([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="subscribe-target" className="text-zinc-700">
              {SUBSCRIPTION_TARGET_LABEL[kind]} específica *
            </Label>
            <Select value={targetId} onValueChange={setTargetId} disabled={optionsLoading}>
              <SelectTrigger id="subscribe-target" className="border-zinc-300" aria-label={`Escolher ${SUBSCRIPTION_TARGET_LABEL[kind]}`}>
                <SelectValue
                  placeholder={
                    optionsLoading
                      ? 'Carregando opções…'
                      : `Selecione ${SUBSCRIPTION_TARGET_LABEL[kind].toLowerCase()}`
                  }
                />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {kind === 'matter' &&
                  (mattersQ.data?.matters ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {MATTER_TYPE_SHORT[m.type] ?? m.type} {m.number}/{m.year} —{' '}
                      {truncate(m.ementa, 52)}
                    </SelectItem>
                  ))}
                {kind === 'session' &&
                  (sessionsQ.data?.sessions ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {SESSION_TYPE_LABEL[s.type] ?? 'Sessão'} nº {s.number}/{s.year} —{' '}
                      {fmtDateTime(s.scheduledAt)}
                    </SelectItem>
                  ))}
                {kind === 'hearing' &&
                  (hearingsQ.data?.hearings ?? []).map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {truncate(h.title, 70)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {!optionsLoading && (
              <p className="text-[11px] text-zinc-500">{targetLabel()} disponível(is) no portal.</p>
            )}
          </div>
        </div>

        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            className="text-white"
            style={{ backgroundColor: primaryColor }}
            onClick={() => subscribe.mutate()}
            disabled={subscribe.isPending || !emailValid || !targetId}
          >
            {subscribe.isPending ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <Bell className="size-3.5" />
            )}
            Acompanhar
          </Button>
        </div>
      </section>

      {/* Nota: dupla confirmação + LGPD */}
      <section
        aria-label="Como funciona o acompanhamento"
        className="rounded-lg border border-zinc-200 p-4"
      >
        <h4 className="flex items-center gap-2 text-sm font-bold">
          <Info className="size-4" style={{ color: primaryColor }} aria-hidden /> Como funciona
        </h4>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-zinc-600">
          <li>Escolha a matéria, a sessão ou a audiência e informe o seu e-mail.</li>
          <li>
            Você recebe um <strong>link de confirmação</strong> — a dupla confirmação (double
            opt-in) impede cadastros em nome de terceiros.
          </li>
          <li>
            Confirmado, você passa a receber as novidades do acompanhamento (pauta, votações,
            publicações e respostas).
          </li>
        </ol>
        <p className="mt-2 border-t border-zinc-100 pt-2 text-xs leading-relaxed text-zinc-500">
          Privacidade (LGPD): o e-mail é utilizado exclusivamente para este acompanhamento, não é
          publicado nem compartilhado, e você pode cancelar a qualquer momento pela Câmara ou pelo
          próprio e-mail.
        </p>
      </section>
    </div>
  )
}

// ─── Módulo ─────────────────────────────────────────────────────────────────

export default function PortalModule() {
  const slug = useApp((s) => s.bootstrap?.tenant.slug ?? null)
  const primaryColor = useApp((s) => s.bootstrap?.tenant.primaryColor ?? '#062f63')
  const [tab, setTab] = useState('live')

  const { data: liveHeader } = useQuery({
    queryKey: ['public-live-header', slug],
    queryFn: () => api.publicLive(slug as string),
    enabled: !!slug,
    refetchInterval: POLL_MS,
  })

  if (!slug) {
    return (
      <div className="space-y-6">
        <PageHeader title="Portal Público" icon={<Globe />} />
        <EmptyState icon={<Globe />} title="Tenant não carregado" description="Aguarde o carregamento do sistema." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Portal Público"
        description="Simulação do portal de transparência white-label publicado para os cidadãos — pesquisa de matérias, histórico de sessões e dados abertos, além da transmissão ao vivo."
        icon={<Globe />}
      />

      <div className="mx-auto max-w-4xl">
        {/* Moldura do portal público (força tema claro institucional) */}
        <div className="overflow-hidden rounded-xl border bg-white text-zinc-900 shadow-sm">
          {/* Header institucional */}
          <div style={{ backgroundColor: liveHeader?.tenant.primaryColor ?? primaryColor }} className="px-5 py-5 text-white sm:px-8">
            <div className="flex items-center gap-3">
              {liveHeader?.tenant.logoUrl
                ? <TenantCrest logoUrl={liveHeader.tenant.logoUrl} name={liveHeader.tenant.name} className="size-12 rounded bg-white p-0.5" />
                : <Landmark className="size-7 shrink-0 opacity-90" aria-hidden />}
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold leading-tight sm:text-xl">
                  {liveHeader?.tenant.name ?? 'Câmara Municipal'}
                </h2>
                <p className="text-xs opacity-85">
                  {liveHeader ? `${liveHeader.tenant.city} · ${liveHeader.tenant.uf}` : ''} · Sessões ao vivo e
                  transparência legislativa
                </p>
              </div>
              <span className="ml-auto hidden items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium sm:inline-flex">
                <Eye className="size-3.5" aria-hidden /> Portal de transparência
              </span>
            </div>
          </div>
          <div style={{ backgroundColor: liveHeader?.tenant.accentColor ?? '#d9a441' }} className="h-1.5" aria-hidden />

          <div className="p-5 sm:p-8">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="mb-5 h-auto w-full flex-wrap justify-start bg-zinc-100">
                <TabsTrigger value="live" className="data-[state=active]:bg-white">
                  <span className="flex items-center gap-1.5">
                    <span className="relative flex size-2" aria-hidden>
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                      <span className="relative inline-flex size-2 rounded-full bg-emerald-600" />
                    </span>
                    Ao Vivo
                  </span>
                </TabsTrigger>
                <TabsTrigger value="matters" className="data-[state=active]:bg-white">
                  <Search className="size-3.5" /> Pesquisa de Matérias
                </TabsTrigger>
                <TabsTrigger value="sessions" className="data-[state=active]:bg-white">
                  <CalendarClock className="size-3.5" /> Sessões
                </TabsTrigger>
                <TabsTrigger value="publications" className="data-[state=active]:bg-white">
                  <Newspaper className="size-3.5" /> Publicações
                </TabsTrigger>
                <TabsTrigger value="hearings" className="data-[state=active]:bg-white">
                  <MessageCircleQuestion className="size-3.5" /> Audiências
                </TabsTrigger>
                <TabsTrigger value="subscribe" className="data-[state=active]:bg-white">
                  <Bell className="size-3.5" /> Acompanhar
                </TabsTrigger>
                <TabsTrigger value="opendata" className="data-[state=active]:bg-white">
                  <Database className="size-3.5" /> Dados Abertos
                </TabsTrigger>
              </TabsList>

              <TabsContent value="live">
                <LiveTab
                  slug={slug}
                  onOpenApi={() =>
                    window.open(`/api/v1/public/live?tenant=${encodeURIComponent(slug)}`, '_blank', 'noopener,noreferrer')
                  }
                />
              </TabsContent>
              <TabsContent value="matters">
                <MattersSearchTab slug={slug} primaryColor={liveHeader?.tenant.primaryColor ?? primaryColor} />
              </TabsContent>
              <TabsContent value="sessions">
                <SessionsTab slug={slug} primaryColor={liveHeader?.tenant.primaryColor ?? primaryColor} />
              </TabsContent>
              <TabsContent value="publications">
                <PublicationsPortalTab slug={slug} primaryColor={liveHeader?.tenant.primaryColor ?? primaryColor} />
              </TabsContent>
              <TabsContent value="hearings">
                <HearingsPortalTab slug={slug} primaryColor={liveHeader?.tenant.primaryColor ?? primaryColor} />
              </TabsContent>
              <TabsContent value="subscribe">
                <SubscribeTab slug={slug} primaryColor={liveHeader?.tenant.primaryColor ?? primaryColor} />
              </TabsContent>
              <TabsContent value="opendata">
                <OpenDataTab slug={slug} primaryColor={liveHeader?.tenant.primaryColor ?? primaryColor} />
              </TabsContent>
            </Tabs>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-xs text-zinc-500 sm:px-8">
            <span>© {liveHeader?.tenant.name ?? 'Câmara Municipal'}</span>
            <span className="flex items-center gap-1">Desenvolvido por <BrandLogo compact /></span>
          </div>
        </div>
      </div>
    </div>
  )
}
