'use client'

/**
 * Fase 17 (Onda 4) — Ciclo de vida da matéria no drawer: seções
 * "Relacionamentos" (altera/revoga/regula/subsidiária/emenda/substitutivo) e
 * "Desfecho (sanção/veto)" com timeline, prazo de apreciação e transição de
 * situação auditada no servidor (POST /matters/:id/related|outcomes).
 *
 * Escrita visível apenas com can('matter.write'); leitura para todo o tenant.
 * Requisições pelas rotas /api/v1/matters/:id/… com apiFetch local (padrão do
 * Console: injeta x-actor-id e traduz Problem Details em mensagem amigável).
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowRight,
  CalendarClock,
  Link2,
  Loader2,
  PlusCircle,
  Stamp,
  Unlink,
  XOctagon,
} from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDate, fmtDateTime, matterLabel } from '@/lib/format'
import {
  MATTER_OUTCOME_KIND_LABEL,
  MATTER_RELATED_KIND_LABEL,
  MATTER_STATUS_LABEL,
  type MatterOutcomeKind,
  type MatterOutcomeView,
  type MatterView,
  type RelatedMatterView,
} from '@/lib/contracts'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

// ─── Cliente local (rotas Fase 17) ─────────────────────────────────────────

type ProblemLike = { title?: string; detail?: string; errors?: Record<string, string[]> }

async function lifecycleFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
  if (actorId) headers.set('x-actor-id', actorId)
  const res = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'same-origin' })
  const text = await res.text()
  const body: unknown = text ? JSON.parse(text) : null
  if (!res.ok) {
    const problem = (body ?? {}) as ProblemLike
    const fieldHint = problem.errors
      ? Object.values(problem.errors)
          .flat()
          .join(' ')
      : ''
    throw new Error(fieldHint || problem.detail || problem.title || `Falha na requisição (${res.status}).`)
  }
  return body as T
}

const RELATED_KINDS = Object.keys(MATTER_RELATED_KIND_LABEL) as Array<
  keyof typeof MATTER_RELATED_KIND_LABEL
>
const OUTCOME_KINDS = Object.keys(MATTER_OUTCOME_KIND_LABEL) as MatterOutcomeKind[]

/** Badge colorida do tipo de vínculo. */
function RelatedKindBadge({ kind }: { kind: keyof typeof MATTER_RELATED_KIND_LABEL }) {
  if (kind === 'emenda' || kind === 'substitutivo')
    return (
      <Badge className="bg-amber-700 text-white hover:bg-amber-700">
        {MATTER_RELATED_KIND_LABEL[kind]}
      </Badge>
    )
  return <Badge variant="secondary">{MATTER_RELATED_KIND_LABEL[kind]}</Badge>
}

/** Badge colorida do desfecho (sanção verde-escuro; vetos vermelho/rust). */
function OutcomeKindBadge({ kind }: { kind: MatterOutcomeKind }) {
  if (kind === 'sancao')
    return (
      <Badge className="gap-1 bg-emerald-800 text-white hover:bg-emerald-800">
        <Stamp className="size-3" aria-hidden /> {MATTER_OUTCOME_KIND_LABEL[kind]}
      </Badge>
    )
  return (
    <Badge
      className={cn(
        'gap-1 text-white',
        kind === 'veto_total' ? 'bg-red-800 hover:bg-red-800' : 'bg-red-700 hover:bg-red-700'
      )}
    >
      <XOctagon className="size-3" aria-hidden /> {MATTER_OUTCOME_KIND_LABEL[kind]}
    </Badge>
  )
}

// ─── Seção Relacionamentos ─────────────────────────────────────────────────

export function RelatedSection({ matter }: { matter: MatterView }) {
  const can = useApp((s) => s.can)
  const canWrite = can('matter.write')
  const queryClient = useQueryClient()
  const [linkOpen, setLinkOpen] = useState(false)
  const [unlinkTarget, setUnlinkTarget] = useState<RelatedMatterView | null>(null)

  const relatedQ = useQuery({
    queryKey: ['matter-related', matter.id],
    queryFn: () => lifecycleFetch<{ related: RelatedMatterView[] }>(`/matters/${matter.id}/related`),
    enabled: !!matter.id,
  })
  const related = relatedQ.data?.related ?? []

  const removeRelated = useMutation({
    mutationFn: (target: RelatedMatterView) =>
      lifecycleFetch<{ ok: boolean }>(
        `/matters/${matter.id}/related?relatedId=${encodeURIComponent(target.id)}`,
        { method: 'DELETE' }
      ),
    onSuccess: (_res, target) => {
      toast.success('Vínculo removido', {
        description: `${matterLabel(matter.type, matter.number, matter.year)} ↔ ${matterLabel(
          target.matter.type,
          target.matter.number,
          target.matter.year
        )} (${MATTER_RELATED_KIND_LABEL[target.kind]}).`,
      })
      void queryClient.invalidateQueries({ queryKey: ['matter-related', matter.id] })
      void queryClient.invalidateQueries({ queryKey: ['matter-detail', matter.id] })
      setUnlinkTarget(null)
    },
    onError: (err: Error) =>
      toast.error('Não foi possível desvincular', { description: err.message }),
  })

  return (
    <section aria-label="Relacionamentos" className="space-y-3 border-b p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <Link2 className="size-4 text-primary" /> Relacionamentos
          <span className="font-normal text-muted-foreground">({related.length})</span>
        </h4>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
            <PlusCircle className="size-3.5" /> Vincular matéria
          </Button>
        )}
      </div>

      {relatedQ.isLoading ? (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : relatedQ.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Não foi possível carregar os relacionamentos.{' '}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => void relatedQ.refetch()}
          >
            Tentar novamente
          </button>
        </p>
      ) : related.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum vínculo registrado — emendas, substitutivos e matérias que alteram, revogam ou
          regulamentam esta podem ser vinculadas aqui.
        </p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto custom-scroll pr-1" aria-label="Matérias vinculadas">
          {related.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-2 rounded-lg border p-2.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <RelatedKindBadge kind={r.kind} />
                  <span className="font-mono text-sm font-bold">
                    {matterLabel(r.matter.type, r.matter.number, r.matter.year)}
                  </span>
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {MATTER_STATUS_LABEL[r.matter.status] ?? r.matter.status}
                  </Badge>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                  {r.direction === 'from' ? (
                    <>
                      <span>Esta matéria</span>
                      <ArrowRight className="size-3 shrink-0" aria-hidden />
                      <span className="font-mono">
                        {matterLabel(r.matter.type, r.matter.number, r.matter.year)}
                      </span>
                      <span className="sr-only">— esta matéria vincula à matéria listada</span>
                    </>
                  ) : (
                    <>
                      <span className="font-mono">
                        {matterLabel(r.matter.type, r.matter.number, r.matter.year)}
                      </span>
                      <ArrowRight className="size-3 shrink-0" aria-hidden />
                      <span>Esta matéria</span>
                      <span className="sr-only">— a matéria listada vincula a esta matéria</span>
                    </>
                  )}
                </p>
                {r.notes && <p className="mt-1 text-xs text-muted-foreground">{r.notes}</p>}
              </div>
              {canWrite && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Desvincular ${matterLabel(r.matter.type, r.matter.number, r.matter.year)} (${MATTER_RELATED_KIND_LABEL[r.kind]})`}
                  onClick={() => setUnlinkTarget(r)}
                >
                  <Unlink className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <LinkMatterDialog matter={matter} open={linkOpen} onOpenChange={setLinkOpen} />

      <AlertDialog
        open={!!unlinkTarget}
        onOpenChange={(open) => !open && setUnlinkTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desvincular matéria?</AlertDialogTitle>
            <AlertDialogDescription>
              O vínculo{' '}
              <strong>
                {MATTER_RELATED_KIND_LABEL[unlinkTarget?.kind ?? 'altera']}
              </strong>{' '}
              com{' '}
              <strong className="font-mono">
                {unlinkTarget &&
                  matterLabel(unlinkTarget.matter.type, unlinkTarget.matter.number, unlinkTarget.matter.year)}
              </strong>{' '}
              será removido. A ação é registrada na auditoria e pode ser recriada depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (unlinkTarget) removeRelated.mutate(unlinkTarget)
              }}
            >
              Desvincular
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function LinkMatterDialog({
  matter,
  open,
  onOpenChange,
}: {
  matter: MatterView
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<keyof typeof MATTER_RELATED_KIND_LABEL>('altera')
  const [targetId, setTargetId] = useState('')
  const [targetSearch, setTargetSearch] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Pool completo de matérias do tenant (endpoint de listagem já existente),
  // carregado apenas com o dialog aberto; a própria matéria é excluída.
  const poolQ = useQuery({
    queryKey: ['matters', 'lifecycle-pool'],
    queryFn: () => api.listMatters({}),
    enabled: open,
    staleTime: 30_000,
  })
  const pool = useMemo(() => {
    const all = (poolQ.data?.matters ?? []).filter((m) => m.id !== matter.id)
    const q = targetSearch.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (m) =>
        matterLabel(m.type, m.number, m.year).toLowerCase().includes(q) ||
        m.ementa.toLowerCase().includes(q)
    )
  }, [poolQ.data, targetSearch, matter.id])

  const createMutation = useMutation({
    mutationFn: () =>
      lifecycleFetch<{ related: RelatedMatterView }>(`/matters/${matter.id}/related`, {
        method: 'POST',
        body: JSON.stringify({ relatedMatterId: targetId, kind, notes: notes.trim() || undefined }),
      }),
    onSuccess: (res) => {
      toast.success('Matéria vinculada', {
        description: `${matterLabel(matter.type, matter.number, matter.year)} → ${matterLabel(
          res.related.matter.type,
          res.related.matter.number,
          res.related.matter.year
        )} (${MATTER_RELATED_KIND_LABEL[res.related.kind]}).`,
      })
      void queryClient.invalidateQueries({ queryKey: ['matter-related', matter.id] })
      void queryClient.invalidateQueries({ queryKey: ['matter-detail', matter.id] })
      setKind('altera')
      setTargetId('')
      setTargetSearch('')
      setNotes('')
      setErrors({})
      onOpenChange(false)
    },
    onError: (err: Error) => toast.error('Não foi possível vincular', { description: err.message }),
  })

  const submit = () => {
    const errs: Record<string, string> = {}
    if (!targetId) errs.targetId = 'Selecione a matéria-alvo do vínculo.'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    createMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto custom-scroll sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Vincular matéria</DialogTitle>
          <DialogDescription>
            Registra o relacionamento de{' '}
            <strong className="font-mono">{matterLabel(matter.type, matter.number, matter.year)}</strong>{' '}
            com outra matéria do tenant (emenda, substitutivo, altera, revoga…). Um par só pode ser
            vinculado uma vez, em qualquer direção.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="related-kind">Tipo de vínculo *</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as keyof typeof MATTER_RELATED_KIND_LABEL)}>
              <SelectTrigger id="related-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATED_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {MATTER_RELATED_KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="related-target">Matéria-alvo *</Label>
            <Input
              id="related-target-search"
              value={targetSearch}
              onChange={(e) => setTargetSearch(e.target.value)}
              placeholder="Filtrar por número ou ementa (ex.: PL 47, acessibilidade…)"
              aria-label="Filtrar matérias para vincular"
            />
            <Select value={targetId || undefined} onValueChange={setTargetId}>
              <SelectTrigger id="related-target" className="w-full" aria-invalid={!!errors.targetId}>
                <SelectValue
                  placeholder={poolQ.isLoading ? 'Carregando matérias…' : 'Selecione a matéria'}
                />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {pool.length === 0 && !poolQ.isLoading ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    Nenhuma matéria encontrada com o filtro atual.
                  </p>
                ) : (
                  pool.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <span className="font-mono text-xs font-bold">
                        {matterLabel(m.type, m.number, m.year)}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {m.ementa.slice(0, 60)}
                        {m.ementa.length > 60 ? '…' : ''}
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {errors.targetId && <p className="text-xs text-destructive">{errors.targetId}</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="related-notes">Notas (opcional)</Label>
            <Textarea
              id="related-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Ex.: Emenda apresentada na CCJ à sessão de hoje."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={createMutation.isPending || poolQ.isLoading}>
            {createMutation.isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Vinculando…
              </>
            ) : (
              'Vincular matéria'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Seção Desfecho (sanção/veto) ──────────────────────────────────────────

export function OutcomeSection({ matter }: { matter: MatterView }) {
  const can = useApp((s) => s.can)
  const canWrite = can('matter.write')
  const [outcomeOpen, setOutcomeOpen] = useState(false)

  // Mantém a situação viva após um registro bem-sucedido (resposta do POST
  // traz a matéria atualizada) — reset derivado no render ao trocar de matéria.
  const [override, setOverride] = useState<MatterView | null>(null)
  const [matterId, setMatterId] = useState(matter.id)
  if (matterId !== matter.id) {
    setMatterId(matter.id)
    setOverride(null)
  }
  const current = override ?? matter

  const outcomesQ = useQuery({
    queryKey: ['matter-outcomes', matter.id],
    queryFn: () =>
      lifecycleFetch<{ outcomes: MatterOutcomeView[] }>(`/matters/${matter.id}/outcomes`),
    enabled: !!matter.id,
  })
  const outcomes = outcomesQ.data?.outcomes ?? []
  const lastOutcome = outcomes.length > 0 ? outcomes[outcomes.length - 1] : null

  // Opções habilitadas conforme as regras do servidor (espelho do backend):
  // sanção com matéria aprovada ou após veto parcial; vetos apenas se aprovada.
  const sancaoEnabled =
    current.status === 'aprovado' ||
    (current.status === 'vetado' && lastOutcome?.kind === 'veto_parcial')
  const vetoEnabled = current.status === 'aprovado'
  const anyEnabled = sancaoEnabled || vetoEnabled

  return (
    <section aria-label="Desfecho (sanção ou veto)" className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <Stamp className="size-4 text-primary" /> Desfecho (sanção/veto)
          <span className="font-normal text-muted-foreground">({outcomes.length})</span>
        </h4>
        {canWrite && anyEnabled && (
          <Button size="sm" variant="outline" onClick={() => setOutcomeOpen(true)}>
            <Stamp className="size-3.5" /> Registrar desfecho
          </Button>
        )}
      </div>

      {outcomesQ.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : outcomesQ.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Não foi possível carregar o desfecho.{' '}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => void outcomesQ.refetch()}
          >
            Tentar novamente
          </button>
        </p>
      ) : outcomes.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Nenhum desfecho registrado. A matéria precisa estar{' '}
          <strong className="text-foreground">aprovada</strong> para receber sanção ou veto — após o
          veto, o Plenário tem prazo regimental (15 dias) para apreciá-lo.
        </p>
      ) : (
        <ol className="relative space-y-0" aria-label="Timeline de desfechos">
          {outcomes.map((o, idx) => (
            <li key={o.id} className="relative flex gap-3 pb-4">
              {idx < outcomes.length - 1 && (
                <span className="absolute left-[15px] top-8 h-full w-px bg-border" aria-hidden />
              )}
              <span
                className={cn(
                  'z-10 flex size-8 shrink-0 items-center justify-center rounded-full border',
                  o.kind === 'sancao'
                    ? 'border-emerald-700/40 bg-emerald-700/10 text-emerald-800'
                    : 'border-red-800/40 bg-red-800/10 text-red-800'
                )}
                aria-hidden
              >
                {o.kind === 'sancao' ? <Stamp className="size-4" /> : <XOctagon className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <OutcomeKindBadge kind={o.kind} />
                  {o.dueAt && (
                    <Badge variant="outline" className="gap-1 border-amber-600/60 text-amber-700">
                      <CalendarClock className="size-3" aria-hidden /> Prazo de apreciação:{' '}
                      {fmtDate(o.dueAt)}
                    </Badge>
                  )}
                </div>
                {o.notes && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{o.notes}</p>}
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                  <span>{fmtDateTime(o.date)}</span>
                  <span>
                    por <strong className="font-medium text-foreground">{o.actorName}</strong>
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}

      <OutcomeDialog
        matter={current}
        sancaoEnabled={sancaoEnabled}
        vetoEnabled={vetoEnabled}
        open={outcomeOpen}
        onOpenChange={setOutcomeOpen}
        onRegistered={(m) => setOverride(m)}
      />
    </section>
  )
}

function defaultDueAtInput(): string {
  const d = new Date()
  d.setDate(d.getDate() + 15)
  return d.toISOString().slice(0, 10)
}

function OutcomeDialog({
  matter,
  sancaoEnabled,
  vetoEnabled,
  open,
  onOpenChange,
  onRegistered,
}: {
  matter: MatterView
  sancaoEnabled: boolean
  vetoEnabled: boolean
  open: boolean
  onOpenChange: (v: boolean) => void
  onRegistered: (matter: MatterView) => void
}) {
  const queryClient = useQueryClient()
  const initialKind: MatterOutcomeKind = sancaoEnabled ? 'sancao' : 'veto_total'
  const [kind, setKind] = useState<MatterOutcomeKind>(initialKind)
  const [actorName, setActorName] = useState('Prefeito Municipal')
  const [notes, setNotes] = useState('')
  const [dueAt, setDueAt] = useState(defaultDueAtInput())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const isVeto = kind !== 'sancao'
  const toStatusLabel = kind === 'sancao' ? MATTER_STATUS_LABEL.sancionado : MATTER_STATUS_LABEL.vetado

  const createMutation = useMutation({
    mutationFn: () =>
      lifecycleFetch<{ outcome: MatterOutcomeView; matter: MatterView }>(
        `/matters/${matter.id}/outcomes`,
        {
          method: 'POST',
          body: JSON.stringify({
            kind,
            actorName: actorName.trim(),
            notes: notes.trim() || undefined,
            dueAt: isVeto && dueAt ? dueAt : undefined,
          }),
        }
      ),
    onSuccess: (res) => {
      toast.success('Desfecho registrado', {
        description: `${matterLabel(matter.type, matter.number, matter.year)} — ${
          MATTER_OUTCOME_KIND_LABEL[res.outcome.kind]
        }: situação agora ${MATTER_STATUS_LABEL[res.matter.status] ?? res.matter.status}${
          res.outcome.dueAt ? ` · apreciação até ${fmtDate(res.outcome.dueAt)}` : ''
        }.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['matter-outcomes', matter.id] })
      void queryClient.invalidateQueries({ queryKey: ['proceedings', matter.id] })
      void queryClient.invalidateQueries({ queryKey: ['matters'] })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      onRegistered(res.matter)
      setKind(sancaoEnabled ? 'sancao' : 'veto_total')
      setActorName('Prefeito Municipal')
      setNotes('')
      setDueAt(defaultDueAtInput())
      setErrors({})
      setConfirmOpen(false)
      onOpenChange(false)
    },
    onError: (err: Error) => {
      setConfirmOpen(false)
      toast.error('Não foi possível registrar o desfecho', { description: err.message })
    },
  })

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (actorName.trim().length < 2) errs.actorName = 'Informe o autor do desfecho.'
    if (isVeto && notes.trim().length === 0)
      errs.notes = 'A justificativa é obrigatória para registrar um veto.'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto custom-scroll sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar desfecho</DialogTitle>
            <DialogDescription>
              Sanção ou veto de{' '}
              <strong className="font-mono">
                {matterLabel(matter.type, matter.number, matter.year)}
              </strong>
              . O registro transiciona a situação da matéria, entra na tramitação e é auditado;
              vetos abrem prazo de apreciação pelo Plenário.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="outcome-kind">Desfecho *</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as MatterOutcomeKind)}
                disabled={!sancaoEnabled && !vetoEnabled}
              >
                <SelectTrigger id="outcome-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sancao" disabled={!sancaoEnabled}>
                    Sanção {sancaoEnabled ? '' : '(exige matéria aprovada ou veto parcial prévio)'}
                  </SelectItem>
                  <SelectItem value="veto_total" disabled={!vetoEnabled}>
                    Veto total {vetoEnabled ? '' : '(exige matéria aprovada)'}
                  </SelectItem>
                  <SelectItem value="veto_parcial" disabled={!vetoEnabled}>
                    Veto parcial {vetoEnabled ? '' : '(exige matéria aprovada)'}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Situação atual: <strong>{MATTER_STATUS_LABEL[matter.status] ?? matter.status}</strong>{' '}
                → após o registro: <strong>{toStatusLabel}</strong>.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="outcome-actor">Autor do desfecho *</Label>
              <Input
                id="outcome-actor"
                value={actorName}
                onChange={(e) => setActorName(e.target.value)}
                placeholder="Ex.: Prefeito Municipal"
                aria-invalid={!!errors.actorName}
              />
              {errors.actorName && <p className="text-xs text-destructive">{errors.actorName}</p>}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="outcome-notes">
                Justificativa {isVeto ? '*' : '(opcional)'}
                {isVeto && <span className="sr-only"> — obrigatória para veto</span>}
              </Label>
              <Textarea
                id="outcome-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder={
                  isVeto
                    ? 'Ex.: Veto total por inconformidade com a Lei de Diretrizes Orçamentárias…'
                    : 'Ex.: Sanção integral com publicação no diário oficial.'
                }
                aria-invalid={!!errors.notes}
              />
              {errors.notes && <p className="text-xs text-destructive">{errors.notes}</p>}
            </div>

            {isVeto && (
              <div className="grid gap-2">
                <Label htmlFor="outcome-due">Prazo de apreciação (opcional)</Label>
                <Input
                  id="outcome-due"
                  type="date"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Padrão regimental: 15 dias após o veto. Uma tarefa “Apreciar veto” será criada
                  para o Plenário.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (validate()) setConfirmOpen(true)
              }}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Registrando…
                </>
              ) : (
                'Continuar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Registrar {MATTER_OUTCOME_KIND_LABEL[kind].toLowerCase()} desta matéria?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {matterLabel(matter.type, matter.number, matter.year)} passará de{' '}
              <strong>{MATTER_STATUS_LABEL[matter.status] ?? matter.status}</strong> para{' '}
              <strong>{toStatusLabel}</strong>
              {isVeto && ' e uma tarefa de apreciação do veto será aberta para o Plenário'}. A ação é
              auditada e a timeline preserva o histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (validate()) createMutation.mutate()
              }}
            >
              Confirmar e registrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * Bloco completo de ciclo de vida (Fase 17) do drawer da matéria:
 * Relacionamentos + Desfecho, nesta ordem.
 */
export default function MatterLifecycleSections({ matter }: { matter: MatterView }) {
  return (
    <>
      <RelatedSection matter={matter} />
      <OutcomeSection matter={matter} />
    </>
  )
}
