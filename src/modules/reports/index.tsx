'use client'

/**
 * Módulo Relatórios — tabs:
 *  - Espelho da Sessão (existente): documento oficial (serif, bordas
 *    sóbrias, imprimível) com presença, ordem do dia, votações (inclusive
 *    nominais), discursos, código de verificação e hash da cadeia;
 *  - Minuta de Ata (Fase 6): documento estruturado imprimível gerado
 *    EXCLUSIVAMENTE de dados persistidos (GET /reports/session/:id/ata);
 *  - Fase 7: seção adicional "Rascunho gerado por IA" (LLM) na Minuta de
 *    Ata — artefato rastreável (modelo/provedor/horário/status) com revisão
 *    humana obrigatória (aprovar/rejeitar); a minuta estruturada permanece
 *    intacta e a IA NUNCA publica nada automaticamente.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  PenLine,
  Printer,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react'

import { api, signaturesApi } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDateShort, fmtDateTime, fmtDuration } from '@/lib/format'
import {
  AGENDA_STATUS_LABEL,
  AI_STATUS_LABEL,
  ATTENDANCE_STATUS_LABEL,
  RESULT_STATUS_LABEL,
  SESSION_STATUS_LABEL,
  SESSION_TYPE_LABEL,
  SPEECH_KIND_LABEL,
  VOTE_VALUE_LABEL,
  VOTING_MODE_LABEL,
  VOTING_RULE_LABEL,
  type AiArtifactView,
  type AtaDraftOutput,
  type AtaReportView,
  type AtaSignaturesView,
  type AttendanceStatus,
  type SessionSummary,
  type VoteRow,
  type VotingView,
} from '@/lib/contracts'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { downloadBlob, formatVerificationCode, shortHash } from '@/modules/_shared'

function DocHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 border-b border-foreground/25 pb-1 text-sm font-bold uppercase tracking-[0.15em]">
      {children}
    </h3>
  )
}

function VoteCounts({ voting }: { voting: VotingView }) {
  const c = voting.resultCounts
  if (!c) return null
  return (
    <p className="tabular-nums">
      Sim: <strong>{c.sim}</strong> · Não: <strong>{c.nao}</strong> · Abstenções: <strong>{c.abstencoes}</strong> · Não
      registraram: <strong>{c.naoRegistraram}</strong> · Presentes: <strong>{c.presentes}</strong>
    </p>
  )
}

function VotingBlock({ voting }: { voting: VotingView }) {
  const isSecret = voting.mode === 'secreto'
  const nominalVotes: VoteRow[] =
    voting.mode === 'nominal' && voting.votes ? voting.votes.filter((v) => v.value !== null) : []

  return (
    <div className="mb-4 ml-4 border-l-2 border-foreground/20 pl-4 text-sm">
      <p className="font-bold">{voting.question}</p>
      <p className="mt-0.5 text-xs">
        Votação {VOTING_MODE_LABEL[voting.mode]} · {VOTING_RULE_LABEL[voting.rule]}
        {voting.justification ? ` · Motivo: ${voting.justification}` : ''}
      </p>
      <p className="mt-1">
        Resultado:{' '}
        <strong>
          {voting.resultStatus ? (RESULT_STATUS_LABEL[voting.resultStatus] ?? voting.resultStatus) : '—'}
        </strong>
      </p>
      <div className="mt-0.5 text-xs">
        <VoteCounts voting={voting} />
      </div>
      {isSecret ? (
        <p className="mt-1 text-xs italic">
          Votação secreta — votos individuais preservados ({voting.registeredCount} voto(s) registrados).
        </p>
      ) : nominalVotes.length > 0 ? (
        <table className="mt-2 w-full max-w-md border-collapse text-xs">
          <caption className="sr-only">Votos nominais da votação {voting.question}</caption>
          <thead>
            <tr className="border-b border-foreground/25 text-left">
              <th scope="col" className="py-1 pr-4 font-semibold">
                Vereador(a)
              </th>
              <th scope="col" className="py-1 font-semibold">
                Voto
              </th>
            </tr>
          </thead>
          <tbody>
            {nominalVotes.map((v) => (
              <tr key={v.parliamentarianId} className="border-b border-foreground/10">
                <td className="py-0.5 pr-4">
                  {v.name} <span className="text-foreground/60">({v.party})</span>
                </td>
                <td className="py-0.5 font-semibold">{VOTE_VALUE_LABEL[v.value ?? 'nao_registrado']}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}

function AtaDoc({ ata }: { ata: AtaReportView }) {
  return (
    <article
      className="mx-auto max-w-4xl border-2 border-foreground/25 bg-card p-6 font-serif shadow-sm sm:p-10 print:max-w-none print:border-0 print:p-0 print:shadow-none"
      aria-label="Minuta de ata"
    >
      <header className="border-b-2 border-foreground/30 pb-4 text-center">
        <h2 className="text-lg font-bold uppercase tracking-wide">Minuta de Ata</h2>
        <p className="mt-1 text-sm font-semibold">
          {ata.session.label} — {SESSION_TYPE_LABEL[ata.session.type]}
        </p>
        <p className="text-xs text-foreground/70">
          {fmtDateTime(ata.session.scheduledAt)} · {ata.session.location}
        </p>
      </header>

      <section className="mt-6 space-y-4 text-sm leading-relaxed" aria-labelledby="ata-opening">
        <div>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.15em] text-foreground/70">
            <span id="ata-opening">1. Abertura</span>
          </h3>
          <p>{ata.opening}</p>
        </div>

        <div>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.15em] text-foreground/70">2. Presença</h3>
          <p>
            <strong>
              Presentes ({ata.attendanceSummary.presentCount}/{ata.attendanceSummary.totalMembers}):
            </strong>{' '}
            {ata.attendanceSummary.present.length > 0
              ? ata.attendanceSummary.present.join(', ')
              : 'Sem registros de presença.'}
          </p>
          {ata.attendanceSummary.byCategory.map((c) => (
            <p key={c.status} className="mt-0.5">
              <strong>
                {ATTENDANCE_STATUS_LABEL[c.status as AttendanceStatus] ?? c.status} ({c.names.length}):
              </strong>{' '}
              {c.names.join(', ')}
            </p>
          ))}
        </div>

        <div>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.15em] text-foreground/70">
            3. Expediente
          </h3>
          {ata.expediente.length === 0 ? (
            <p className="italic">Sem itens de expediente registrados.</p>
          ) : (
            <ol className="ml-4 list-decimal space-y-1">
              {ata.expediente.map((item) => (
                <li key={item.order}>
                  {item.title}{' '}
                  <span className="text-foreground/60">({AGENDA_STATUS_LABEL[item.status as 'pendente'] ?? item.status})</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.15em] text-foreground/70">
            4. Votações
          </h3>
          {ata.votings.length === 0 ? (
            <p className="italic">Nenhuma votação encerrada com resultado nesta sessão.</p>
          ) : (
            <div className="space-y-3">
              {ata.votings.map((v) => (
                <div key={v.id} className="ml-4 border-l-2 border-foreground/20 pl-4">
                  <p className="font-bold">{v.question}</p>
                  <p className="text-xs">
                    Votação {VOTING_MODE_LABEL[v.mode]} · {VOTING_RULE_LABEL[v.rule]} — resultado:{' '}
                    <strong>{RESULT_STATUS_LABEL[v.result] ?? v.result}</strong>
                  </p>
                  {v.counts && (
                    <p className="text-xs tabular-nums">
                      Sim: {v.counts.sim} · Não: {v.counts.nao} · Abstenções: {v.counts.abstencoes} · Não registraram:{' '}
                      {v.counts.naoRegistraram} · Presentes: {v.counts.presentes}
                    </p>
                  )}
                  {v.nominal && v.nominal.length > 0 ? (
                    <ul className="mt-1 ml-4 list-disc text-xs">
                      {v.nominal.map((n) => (
                        <li key={n.name}>
                          {n.name} <span className="text-foreground/60">({n.party})</span> —{' '}
                          {VOTE_VALUE_LABEL[n.value]}
                        </li>
                      ))}
                    </ul>
                  ) : v.mode === 'secreto' ? (
                    <p className="mt-0.5 text-xs italic">Votação secreta — votos individuais preservados.</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.15em] text-foreground/70">
            5. Discursos
          </h3>
          {ata.speeches.length === 0 ? (
            <p className="italic">Nenhum discurso registrado.</p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <caption className="sr-only">Discursos proferidos</caption>
              <thead>
                <tr className="border-b border-foreground/25 text-left">
                  <th scope="col" className="py-1 pr-4 font-semibold">Orador(a)</th>
                  <th scope="col" className="py-1 pr-4 font-semibold">Tipo</th>
                  <th scope="col" className="py-1 pr-4 font-semibold">Assunto</th>
                  <th scope="col" className="py-1 font-semibold">Duração</th>
                </tr>
              </thead>
              <tbody>
                {ata.speeches.map((s, i) => (
                  <tr key={i} className="border-b border-foreground/10">
                    <td className="py-1 pr-4">{s.speakerName}</td>
                    <td className="py-1 pr-4">{SPEECH_KIND_LABEL[s.kind] ?? s.kind}</td>
                    <td className="py-1 pr-4">{s.subject ?? '—'}</td>
                    <td className="py-1 tabular-nums">{fmtDuration(s.durationSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.15em] text-foreground/70">
            6. Encerramento
          </h3>
          <p>{ata.closing}</p>
        </div>
      </section>

      <footer className="mt-10 border-t border-foreground/25 pt-4 text-center text-xs leading-relaxed">
        <p>
          Minuta gerada por <strong>edocBR Plenário</strong> exclusivamente a partir de dados persistidos da sessão em{' '}
          {new Date().toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })}.
        </p>
        <p className="mt-1">
          Código de verificação:{' '}
          <strong className="font-mono tracking-wider">{formatVerificationCode(ata.verificationCode)}</strong>
        </p>
      </footer>
    </article>
  )
}

// ─── Fase 7: rascunho de ata por IA (seção adicional da tab Minuta de Ata) ──

function AiDraftBadge({ status }: { status: AiArtifactView['status'] }) {
  if (status === 'approved')
    return (
      <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
        <CheckCircle2 className="size-3" /> {AI_STATUS_LABEL.approved}
      </Badge>
    )
  if (status === 'rejected')
    return (
      <Badge className="gap-1 bg-rose-600 text-white hover:bg-rose-600">
        <XCircle className="size-3" /> {AI_STATUS_LABEL.rejected}
      </Badge>
    )
  return <Badge variant="secondary" className="gap-1"><Sparkles className="size-3" /> {AI_STATUS_LABEL.draft}</Badge>
}

function AiAtaDraftSection({ sessionId }: { sessionId: string }) {
  const can = useApp((s) => s.can)
  const canUse = can('ai.use')
  const canReview = can('ai.review')
  const queryClient = useQueryClient()
  const [approveOpen, setApproveOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [justification, setJustification] = useState('')
  const [rejectError, setRejectError] = useState<string | null>(null)

  const artifactsQ = useQuery({
    queryKey: ['ai-artifacts', 'ata_draft', sessionId],
    queryFn: () => api.listAiArtifacts({ kind: 'ata_draft', sessionId, limit: 1 }),
    enabled: !!sessionId,
  })
  const artifact = artifactsQ.data?.artifacts[0] ?? null
  const draft = artifact ? (artifact.output as unknown as AtaDraftOutput) : null

  const generate = useMutation({
    mutationFn: () => api.aiAtaDraft(sessionId),
    onSuccess: () => {
      toast.success('Rascunho gerado por IA', {
        description: 'Artefato registrado com status Rascunho — revisão humana obrigatória.',
      })
      void queryClient.invalidateQueries({ queryKey: ['ai-artifacts'] })
    },
  })

  const review = useMutation({
    mutationFn: (data: { decision: 'approve' | 'reject'; justification?: string }) =>
      api.reviewAiArtifact(artifact!.id, data),
    onSuccess: (res) => {
      setApproveOpen(false)
      setRejectOpen(false)
      setJustification('')
      setRejectError(null)
      toast.success(
        res.artifact.status === 'approved' ? 'Rascunho aprovado' : 'Rascunho rejeitado',
        {
          description:
            res.artifact.status === 'approved'
              ? `Aprovado por ${res.artifact.reviewedBy}. Aprovação NÃO publica o documento automaticamente.`
              : `Rejeitado por ${res.artifact.reviewedBy}. O artefato permanece registrado para auditoria.`,
        }
      )
      void queryClient.invalidateQueries({ queryKey: ['ai-artifacts'] })
    },
  })

  return (
    <section
      aria-label="Rascunho de ata gerado por IA"
      className="no-print space-y-4 rounded-xl border border-primary/30 bg-primary/[0.03] p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" aria-hidden /> Rascunho gerado por IA
          </h3>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            Minuta redigida por LLM a partir exclusivamente dos dados persistidos da sessão.
            Marcadores [CONFIRMAR] indicam lacunas. Aprovar NÃO publica o documento — a minuta
            estruturada acima permanece a fonte oficial.
          </p>
        </div>
        {canUse && (
          <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? (
              <>
                <Loader2 className="animate-spin" /> Gerando…
              </>
            ) : (
              <>
                <Sparkles /> Gerar minuta com assistência de IA
              </>
            )}
          </Button>
        )}
      </div>

      {generate.isPending && (
        <div className="space-y-2" aria-live="polite">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Consultando o modelo de linguagem — pode levar até um minuto…
          </p>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {artifactsQ.isLoading && !generate.isPending && <Skeleton className="h-16 w-full" />}

      {artifact && draft && !generate.isPending && (
        <div className="space-y-4">
          {/* Origem do artefato — sempre visível (modelo/provedor/horário/status) */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <AiDraftBadge status={artifact.status} />
            <Badge variant="outline" className="font-mono text-[11px]">{artifact.model}</Badge>
            <Badge variant="outline" className="text-[11px]">provedor: {artifact.provider}</Badge>
            <span>{fmtDateTime(artifact.createdAt)}</span>
            {artifact.status === 'approved' && (
              <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
                Aprovada por {artifact.reviewedBy}
              </Badge>
            )}
            {artifact.status === 'rejected' && (
              <Badge variant="outline" className="text-rose-700 dark:text-rose-400">
                Rejeitada por {artifact.reviewedBy}
              </Badge>
            )}
          </div>

          <div className="rounded-lg border bg-card p-4">
            <p className="font-serif text-sm font-bold">{draft.titulo}</p>
            <div className="mt-3 space-y-3">
              {draft.secoes.map((s, i) => (
                <div key={`${s.titulo}-${i}`}>
                  <p className="text-xs font-bold uppercase tracking-wide text-foreground/70">{s.titulo}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">{s.texto}</p>
                </div>
              ))}
            </div>
            {draft.observacao && (
              <p className="mt-3 rounded-md bg-muted p-2 text-xs italic text-muted-foreground">
                {draft.observacao}
              </p>
            )}
          </div>

          {artifact.status === 'draft' && canReview && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setApproveOpen(true)} disabled={review.isPending}>
                <CheckCircle2 className="size-4" /> Aprovar rascunho
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setRejectOpen(true)} disabled={review.isPending}>
                <XCircle className="size-4" /> Rejeitar
              </Button>
            </div>
          )}
        </div>
      )}

      {!artifact && !generate.isPending && !artifactsQ.isLoading && (
        <p className="text-sm text-muted-foreground">
          Nenhum rascunho de IA gerado para esta sessão ainda.
        </p>
      )}

      {/* Confirmação de aprovação */}
      <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aprovar rascunho de IA?</AlertDialogTitle>
            <AlertDialogDescription>
              A aprovação registra você como revisor(a) no artefato auditado. Ela NÃO publica a ata nem
              substitui a minuta estruturada — a publicação continua sendo um ato manual e oficial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => review.mutate({ decision: 'approve' })} disabled={review.isPending}>
              {review.isPending ? 'Registrando…' : 'Aprovar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rejeição com justificativa obrigatória */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rejeitar rascunho de IA</DialogTitle>
            <DialogDescription>
              A justificativa é obrigatória e fica registrada na auditoria (hash chain).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Textarea
              id="reject-justification"
              value={justification}
              onChange={(e) => {
                setJustification(e.target.value)
                setRejectError(null)
              }}
              rows={4}
              placeholder="Ex.: seções com dados incorretos, faltou resultado da matéria X…"
              aria-invalid={!!rejectError}
            />
            {rejectError && <p className="text-xs text-destructive">{rejectError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={review.isPending}
              onClick={() => {
                if (justification.trim().length < 3) {
                  setRejectError('Descreva o motivo da rejeição (mín. 3 caracteres).')
                  return
                }
                review.mutate({ decision: 'reject', justification: justification.trim() })
              }}
            >
              {review.isPending ? 'Registrando…' : 'Rejeitar artefato'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ─── F22: painel "Assinaturas eletrônicas" da ata ──────────────────────────

/** Painel de assinaturas da ata (signaturesApi.ataPanel — ADR-023). */
function AtaSignaturesPanel({ sessionId }: { sessionId: string }) {
  const panelQ = useQuery({
    queryKey: ['ata-signatures', sessionId],
    queryFn: () => signaturesApi.ataPanel(sessionId),
  })
  const panel: AtaSignaturesView | null = panelQ.data ?? null

  if (panelQ.isLoading) {
    return (
      <section className="space-y-3" aria-label="Assinaturas eletrônicas da ata">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </section>
    )
  }
  if (panelQ.isError || !panel) return null

  const signedCount = panel.eligible.filter((e) => e.signed).length
  const pending = panel.eligible.filter((e) => !e.signed)

  return (
    <section className="space-y-3" aria-label="Assinaturas eletrônicas da ata">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <PenLine className="size-4 text-primary" aria-hidden /> Assinaturas eletrônicas
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-primary/15 text-primary tabular-nums">
            {signedCount}/{panel.eligible.length} assinadas
          </Badge>
          {panel.chainValid ? (
            <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="size-3" aria-hidden /> Cadeia verificada ✓
            </Badge>
          ) : (
            <Badge className="gap-1 bg-rose-500/15 text-rose-700 dark:text-rose-300">
              <ShieldAlert className="size-3" aria-hidden /> Cadeia ÍNTEGRA NÃO confere
            </Badge>
          )}
        </div>
      </div>

      {!panel.published ? (
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          A ata desta sessão ainda não foi publicada no diário eletrônico — as assinaturas
          eletrônicas ficam disponíveis após a publicação (publicações com tipo “Ata de Sessão”).
        </div>
      ) : (
        <>
          {/* Elegíveis: assinados + pendentes */}
          <div className="max-h-72 overflow-y-auto custom-scroll rounded-xl border bg-card">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Parlamentares presentes na sessão e suas assinaturas eletrônicas
              </caption>
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">Parlamentar presente</th>
                  <th scope="col" className="px-3 py-2 font-medium">Assinatura</th>
                  <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">Horário</th>
                </tr>
              </thead>
              <tbody>
                {panel.eligible.map((e) => (
                  <tr key={e.parliamentarianId} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <span className="font-medium">{e.name}</span>
                    </td>
                    <td className="px-3 py-2">
                      {e.signed ? (
                        <span className="font-mono text-xs font-semibold tracking-wider text-emerald-700 dark:text-emerald-400">
                          {e.signatureCode}
                        </span>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Pendente</Badge>
                      )}
                    </td>
                    <td className="hidden px-3 py-2 text-xs text-muted-foreground sm:table-cell">
                      {e.signed && e.signedAt ? fmtDateTime(e.signedAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-2 text-xs text-muted-foreground">
            <p className="flex items-start gap-1.5">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
              <span>
                docHash da ata publicada:{' '}
                <span className="font-mono break-all">{shortHash(panel.docHash ?? '—')}</span>{' '}
                (sha256 do conteúdo; cadeia de HMAC por assinatura — ADR-023).
              </span>
            </p>
            <p className="flex items-start gap-1.5">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
              <span>
                A assinatura atesta a <strong>presença</strong> na sessão — o voto secreto
                permanece sigiloso (a assinatura NUNCA revela o voto).
              </span>
            </p>
            {pending.length > 0 && (
              <p className="flex items-start gap-1.5">
                <PenLine className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                <span>
                  {pending.length} pendente(s): {pending.map((p) => p.name).join(', ')} — cada
                  parlamentar assina pelo <strong>App do Parlamentar</strong> (card “Assinar ata da
                  sessão”, um toque).
                </span>
              </p>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function AtaTab({ sessions }: { sessions: SessionSummary[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viewId, setViewId] = useState<string | null>(null)

  const effectiveId =
    selectedId && sessions.some((s) => s.id === selectedId)
      ? selectedId
      : sessions.find((s) => s.status === 'closed')?.id ?? sessions[0]?.id ?? null

  const ataQ = useQuery({
    queryKey: ['ata', viewId],
    queryFn: () => api.sessionAta(viewId as string),
    enabled: !!viewId,
  })

  const selectLabel = (s: SessionSummary) =>
    `${SESSION_TYPE_LABEL[s.type]} nº ${s.number}/${s.year} — ${fmtDateShort(s.scheduledAt)} [${SESSION_STATUS_LABEL[s.status]}]`

  return (
    <div className="space-y-5">
      <div className="no-print grid max-w-xl gap-2">
        <Select value={effectiveId ?? undefined} onValueChange={setSelectedId}>
          <SelectTrigger aria-label="Selecionar sessão para a minuta de ata">
            <SelectValue placeholder={sessions.length === 0 ? 'Nenhuma sessão' : 'Selecione a sessão'} />
          </SelectTrigger>
          <SelectContent>
            {sessions.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {selectLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setViewId(effectiveId)} disabled={!effectiveId}>
            <FileText /> Visualizar minuta
          </Button>
          {ataQ.data && (
            <>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer /> Imprimir / PDF
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  downloadBlob(
                    `minuta-ata-${ataQ.data.ata.session.number}-${ataQ.data.ata.session.year}.json`,
                    JSON.stringify(ataQ.data, null, 2),
                    'application/json'
                  )
                  toast.success('JSON exportado')
                }}
              >
                <Download /> Exportar JSON
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          A minuta é gerada apenas de dados persistidos (abertura, presença consolidada, expediente, votações
          com resultado, discursos e encerramento) e inclui código de verificação da cadeia de auditoria.
        </p>
      </div>

      {/* F22 — painel de assinaturas eletrônicas da ata da sessão */}
      {effectiveId && <AtaSignaturesPanel sessionId={effectiveId} />}

      {/* Fase 7 — rascunho assistido por IA (seção adicional; minuta estruturada intacta) */}
      {effectiveId && <AiAtaDraftSection sessionId={effectiveId} />}

      {ataQ.isLoading ? (
        <div className="mx-auto max-w-4xl space-y-4">
          <Skeleton className="mx-auto h-10 w-72" />
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      ) : ataQ.data ? (
        <AtaDoc ata={ataQ.data.ata} />
      ) : (
        <EmptyState
          icon={<FileText />}
          title="Nenhuma minuta carregada"
          description="Selecione uma sessão e clique em “Visualizar minuta” para gerar o documento estruturado."
        />
      )}
    </div>
  )
}

export default function ReportsModule() {
  const [tab, setTab] = useState('mirror')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const sessionsQ = useQuery({ queryKey: ['sessions'], queryFn: () => api.listSessions() })
  const sessions = sessionsQ.data?.sessions ?? []

  // Default: primeira (mais recente) encerrada; senão a primeira da lista
  const effectiveId = useMemo(() => {
    if (selectedId && sessions.some((s) => s.id === selectedId)) return selectedId
    return sessions.find((s) => s.status === 'closed')?.id ?? sessions[0]?.id ?? null
  }, [selectedId, sessions])

  const reportQ = useQuery({
    queryKey: ['report', effectiveId],
    queryFn: () => api.sessionReport(effectiveId as string),
    enabled: !!effectiveId,
  })

  const report = reportQ.data
  const detail = report?.session
  const session: SessionSummary | undefined = detail?.session

  const selectLabel = (s: SessionSummary) =>
    `${SESSION_TYPE_LABEL[s.type]} nº ${s.number}/${s.year} — ${fmtDateShort(s.scheduledAt)} [${SESSION_STATUS_LABEL[s.status]}]`

  const exportJson = () => {
    if (!report) return
    downloadBlob(
      `espelho-sessao-${session?.number ?? 'x'}-${session?.year ?? ''}.json`,
      JSON.stringify(report, null, 2),
      'application/json'
    )
    toast.success('JSON exportado', { description: `Espelho da sessão nº ${session?.number}/${session?.year}.` })
  }

  const attendanceByCategory = useMemo(() => {
    const map = new Map<AttendanceStatus, string[]>()
    for (const row of detail?.attendance ?? []) {
      if (row.present) continue
      const list = map.get(row.status) ?? []
      list.push(row.name)
      map.set(row.status, list)
    }
    return map
  }, [detail])

  const presentNames = (detail?.attendance ?? []).filter((a) => a.present).map((a) => a.name)

  const unlinkedVotings = (detail?.votings ?? []).filter((v) => !v.agendaItemId)

  return (
    <div className="space-y-6">
      <div className="no-print">
        <PageHeader
          title="Relatórios"
          description="Espelho da sessão com valor probatório e minuta de ata estruturada — presença, votações, discursos e verificação de integridade."
          icon={<ScrollText />}
          actions={
            tab === 'mirror' ? (
              <>
                <Button variant="outline" onClick={exportJson} disabled={!report}>
                  <Download /> Exportar JSON
                </Button>
                <Button onClick={() => window.print()} disabled={!report}>
                  <Printer /> Imprimir / PDF
                </Button>
              </>
            ) : undefined
          }
        />

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="mirror">
              <ScrollText className="size-3.5" /> Espelho da Sessão
            </TabsTrigger>
            <TabsTrigger value="ata">
              <FileText className="size-3.5" /> Minuta de Ata
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsContent value="mirror" className="space-y-6 mt-0">
          <div className="no-print">
            <div className="grid max-w-md gap-1.5">
              <Select value={effectiveId ?? undefined} onValueChange={setSelectedId}>
                <SelectTrigger aria-label="Selecionar sessão para o relatório" className="w-full">
                  <SelectValue placeholder={sessionsQ.isLoading ? 'Carregando sessões…' : 'Selecione a sessão'} />
                </SelectTrigger>
                <SelectContent>
                  {sessions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {selectLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Padrão: sessão encerrada mais recente. Sessões em andamento também podem ser espelhadas.
              </p>
            </div>
          </div>

          {/* Documento */}
          {reportQ.isLoading || !report || !session || !detail ? (
        <div className="mx-auto max-w-4xl space-y-4">
          <Skeleton className="mx-auto h-10 w-72" />
          <Skeleton className="h-6 w-full max-w-md" />
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      ) : (
        <article
          className="mx-auto max-w-4xl border-2 border-foreground/25 bg-card p-6 font-serif shadow-sm sm:p-10 print:max-w-none print:border-0 print:p-0 print:shadow-none"
          aria-label="Espelho da sessão"
        >
          {/* Cabeçalho institucional */}
          <header className="border-b-2 border-foreground/30 pb-4 text-center">
            <h2 className="text-lg font-bold uppercase tracking-wide">{report.tenant.name}</h2>
            <p className="text-xs text-foreground/70">
              {report.tenant.city} — {report.tenant.uf} · Poder Legislativo Municipal
            </p>
            <p className="mt-6 text-xl font-bold tracking-[0.25em]">ESPELHO DE SESSÃO</p>
            <p className="mt-1 text-sm">
              {SESSION_TYPE_LABEL[session.type]} nº {session.number} de {session.year}
            </p>
          </header>

          {/* Identificação */}
          <dl className="grid grid-cols-1 gap-x-8 gap-y-1 border-b border-foreground/20 py-4 text-sm sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="font-bold">Data e hora:</dt>
              <dd>{fmtDateTime(session.scheduledAt)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-bold">Presidente:</dt>
              <dd>{session.presidentName ?? '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-bold">Secretário(a):</dt>
              <dd>{session.secretaryName ?? '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-bold">Local:</dt>
              <dd>{session.location}</dd>
            </div>
            {session.openedAt && (
              <div className="flex gap-2">
                <dt className="font-bold">Abertura:</dt>
                <dd>{fmtDateTime(session.openedAt)}</dd>
              </div>
            )}
            {session.closedAt && (
              <div className="flex gap-2">
                <dt className="font-bold">Encerramento:</dt>
                <dd>{fmtDateTime(session.closedAt)}</dd>
              </div>
            )}
          </dl>

          {/* 1. Presença */}
          <section className="mt-6" aria-labelledby="report-attendance">
            <DocHeading>
              <span id="report-attendance">1. Presença</span>
            </DocHeading>
            <p className="text-sm">
              <strong>
                Presentes ({presentNames.length}/{session.totalMembers}):
              </strong>{' '}
              {presentNames.length > 0 ? presentNames.join(', ') : 'Sem registros de presença.'}
            </p>
            {[...attendanceByCategory.entries()].map(([status, names]) => (
              <p key={status} className="mt-1 text-sm">
                <strong>
                  {ATTENDANCE_STATUS_LABEL[status]} ({names.length}):
                </strong>{' '}
                {names.join(', ')}
              </p>
            ))}
            <p className="mt-1 text-xs text-foreground/70">
              Quórum registrado no encerramento: {detail.quorum.present} presentes · mínimo regimental{' '}
              {detail.quorum.required}.
            </p>
          </section>

          {/* 2. Ordem do dia */}
          <section className="mt-8" aria-labelledby="report-agenda">
            <DocHeading>
              <span id="report-agenda">2. Ordem do Dia</span>
            </DocHeading>
            {detail.agenda.length === 0 ? (
              <p className="text-sm italic">Sessão sem pauta publicada.</p>
            ) : (
              <ol className="space-y-3">
                {detail.agenda.map((item) => {
                  const linked = detail.votings.filter((v) => v.agendaItemId === item.id)
                  return (
                    <li key={item.id} className="text-sm">
                      <p>
                        <strong className="tabular-nums">{item.order + 1}.</strong> {item.title}{' '}
                        <span className="text-foreground/70">— {AGENDA_STATUS_LABEL[item.status]}</span>
                      </p>
                      {item.resultSummary && <p className="ml-4 text-xs">{item.resultSummary}</p>}
                      {linked.map((v) => (
                        <VotingBlock key={v.id} voting={v} />
                      ))}
                    </li>
                  )
                })}
              </ol>
            )}
          </section>

          {/* 3. Votações avulsas */}
          {unlinkedVotings.length > 0 && (
            <section className="mt-8" aria-labelledby="report-votings">
              <DocHeading>
                <span id="report-votings">3. Votações realizadas na sessão</span>
              </DocHeading>
              {unlinkedVotings.map((v) => (
                <VotingBlock key={v.id} voting={v} />
              ))}
            </section>
          )}

          {/* 4. Discursos */}
          <section className="mt-8" aria-labelledby="report-speeches">
            <DocHeading>
              <span id="report-speeches">
                {unlinkedVotings.length > 0 ? '4. Discursos' : '3. Discursos'}
              </span>
            </DocHeading>
            {detail.speeches.length === 0 ? (
              <p className="text-sm italic">Nenhum discurso registrado nesta sessão.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Discursos proferidos na sessão</caption>
                <thead>
                  <tr className="border-b border-foreground/25 text-left">
                    <th scope="col" className="py-1 pr-4 font-semibold">
                      Orador(a)
                    </th>
                    <th scope="col" className="py-1 pr-4 font-semibold">
                      Tipo
                    </th>
                    <th scope="col" className="py-1 pr-4 font-semibold">
                      Assunto
                    </th>
                    <th scope="col" className="py-1 font-semibold">
                      Tempo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.speeches.map((s) => (
                    <tr key={s.id} className="border-b border-foreground/10 align-top">
                      <td className="py-1 pr-4">{s.speakerName}</td>
                      <td className="py-1 pr-4">{SPEECH_KIND_LABEL[s.kind] ?? s.kind}</td>
                      <td className="py-1 pr-4">{s.subject ?? '—'}</td>
                      <td className="py-1 tabular-nums">
                        {fmtDuration(s.elapsedSeconds)} de {fmtDuration(s.plannedSeconds)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Rodapé de verificação */}
          <footer className="mt-10 border-t border-foreground/25 pt-4 text-center text-xs leading-relaxed">
            <p>
              Documento gerado por <strong>edocBR Plenário</strong> em{' '}
              {new Date().toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })}.
            </p>
            <p className="mt-1">
              Código de verificação: <strong className="font-mono tracking-wider">{formatVerificationCode(report.verificationCode)}</strong>
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-foreground/70">
              hash da cadeia: {shortHash(report.auditChain.head, 16)} · {report.auditChain.events} eventos auditados ·
              cadeia {report.auditChain.valid ? 'válida' : 'INVÁLIDA'}
            </p>
          </footer>
        </article>
          )}

          {sessions.length === 0 && !sessionsQ.isLoading && (
            <EmptyState
              icon={<ScrollText />}
              title="Nenhuma sessão disponível"
              description="Cadastre uma sessão para gerar o espelho correspondente."
            />
          )}
        </TabsContent>

        <TabsContent value="ata" className="mt-0">
          <AtaTab sessions={sessions} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
