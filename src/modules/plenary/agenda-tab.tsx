'use client'

/**
 * Tab Pauta — seções (Expediente / Ordem do Dia / Comunicações) com
 * condução dos itens: mover, em leitura/em discussão, iniciar votação,
 * retirar/adiar (com justificativa) e adicionar matérias.
 */

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CalendarClock,
  Eye,
  Gavel,
  ListChecks,
  MessageSquareText,
  Plus,
  Trash2,
} from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import type { AgendaItemView, SessionDetail, VotingMode, VotingRule } from '@/lib/contracts'
import { VOTING_MODE_LABEL, VOTING_RULE_LABEL } from '@/lib/contracts'
import { matterFullLabel } from '@/lib/format'
import { AgendaStatusBadge } from '@/components/app/badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { AGENDA_SECTIONS, resultSummaryClass, VOTING_CREATION_STATUSES } from './helpers'
import { AgendaAmendmentDialog } from '@/modules/sessions/agenda-amendment-dialog'

type AgendaIncidentAction = 'retirar' | 'adiar' | 'vista' | 'destaque'

type Props = { data: SessionDetail; invalidate: () => void; onGoToVoting: () => void }

const VOTING_MODE_HINT: Record<VotingMode, string> = {
  nominal: 'Cada parlamentar vota pelo nome; resultado nominal divulgado.',
  simbolico: 'Contagens (sim/não/abstenções) informadas pela mesa no encerramento.',
  secreto: 'Voto sigiloso; apenas o resultado agregado é divulgado.',
}

export function AgendaTab({ data, invalidate, onGoToVoting }: Props) {
  const canEdit = useApp((s) => s.can('session.create'))
  const canConduct = useApp((s) => s.can('session.transition'))
  const canVote = useApp((s) => s.can('voting.write'))
  const [votingItem, setVotingItem] = useState<AgendaItemView | null>(null)
  const [justifyTarget, setJustifyTarget] = useState<{ item: AgendaItemView; action: AgendaIncidentAction } | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [amendOpen, setAmendOpen] = useState(false)

  const session = data.session
  const votingAllowed = VOTING_CREATION_STATUSES.includes(session.status)
  const editAllowed = session.status === 'draft' && canEdit

  const patch = useMutation({
    mutationFn: (vars: {
      itemId: string
      body: { action: string; order?: number; status?: string; justification?: string }
      success: string
    }) => api.patchAgendaItem(vars.itemId, vars.body),
    onSuccess: (_r, vars) => {
      invalidate()
      toast.success(vars.success)
    },
  })

  const agenda = data.agenda
  const bySection = useMemo(
    () =>
      AGENDA_SECTIONS.map((sec) => ({
        ...sec,
        items: agenda.filter((i) => i.section === sec.key),
      })).filter((s) => s.items.length > 0),
    [agenda]
  )

  const move = (item: AgendaItemView, dir: -1 | 1) => {
    const idx = agenda.findIndex((i) => i.id === item.id)
    const target = agenda[idx + dir]
    if (!target || target.section !== item.section) return
    void patch.mutate({
      itemId: item.id,
      body: { action: 'reorder', order: idx + dir },
      success: 'Pauta reordenada.',
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {agenda.length} {agenda.length === 1 ? 'item na pauta' : 'itens na pauta'} · conduza os
          trabalhos item a item
        </p>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} disabled={!editAllowed}>
          <Plus /> Adicionar matérias à pauta
        </Button>
        {session.status === 'scheduled' && canConduct && <Button size="sm" variant="outline" onClick={() => setAmendOpen(true)}>Emendar pauta publicada</Button>}
      </div>

      {!votingAllowed && (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          Votações e condução dos itens começam após a abertura da sessão. Antes do credenciamento, altere a pauta publicada por emenda versionada.
        </p>
      )}

      {bySection.map((sec) => (
        <Card key={sec.key}>
          <CardHeader className="py-3">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {sec.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {sec.items.map((item, i) => (
              <AgendaRow
                key={item.id}
                item={item}
                num={i + 1}
                firstInSection={i === 0}
                lastInSection={i === sec.items.length - 1}
                canMove={canConduct && session.status === 'draft'}
                canConduct={canConduct && ['open', 'suspended', 'resumed'].includes(session.status)}
                canRetire={canConduct && ['draft', 'open', 'suspended', 'resumed'].includes(session.status)}
                canVote={canVote}
                votingAllowed={votingAllowed}
                busy={patch.isPending}
                onMove={(dir) => move(item, dir)}
                onStatus={(status) =>
                  void patch.mutate({
                    itemId: item.id,
                    body: { action: 'status', status },
                    success: `Item em ${status === 'em_leitura' ? 'leitura' : 'discussão'}.`,
                  })
                }
                onOpenVoting={() => setVotingItem(item)}
                onJustify={(action) => setJustifyTarget({ item, action })}
              />
            ))}
          </CardContent>
        </Card>
      ))}

      <VotingSetupDialog
        item={votingItem}
        open={!!votingItem}
        onOpenChange={(open) => !open && setVotingItem(null)}
        sessionId={data.session.id}
        official={data.session.official}
        invalidate={invalidate}
        onCreated={onGoToVoting}
      />

      <JustifyDialog
        key={justifyTarget ? `${justifyTarget.item.id}:${justifyTarget.action}` : 'none'}
        target={justifyTarget}
        onOpenChange={(open) => !open && setJustifyTarget(null)}
        busy={patch.isPending}
        onConfirm={(justification) => {
          if (!justifyTarget) return
          void patch.mutate({
            itemId: justifyTarget.item.id,
            body: { action: justifyTarget.action, justification },
            success:
              justifyTarget.action === 'retirar'
                ? 'Item retirado da pauta.'
                : 'Item adiado para sessão futura.',
          })
        }}
      />

      <AddMattersDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        sessionId={data.session.id}
        existingMatterIds={new Set(agenda.map((i) => i.matterId).filter((x): x is string => !!x))}
        invalidate={invalidate}
      />
      {amendOpen && <AgendaAmendmentDialog key={`${session.id}-${session.version}`} sessionId={session.id} version={session.version} agenda={agenda} onClose={() => { setAmendOpen(false); invalidate() }} />}
    </div>
  )
}

// ─── Linha do item de pauta ────────────────────────────────────────────────

function AgendaRow({
  item,
  num,
  firstInSection,
  lastInSection,
  canMove,
  canConduct,
  canRetire,
  canVote,
  votingAllowed,
  busy,
  onMove,
  onStatus,
  onOpenVoting,
  onJustify,
}: {
  item: AgendaItemView
  num: number
  firstInSection: boolean
  lastInSection: boolean
  canMove: boolean
  canConduct: boolean
  canRetire: boolean
  canVote: boolean
  votingAllowed: boolean
  busy: boolean
  onMove: (dir: -1 | 1) => void
  onStatus: (status: 'em_leitura' | 'em_discussao') => void
  onOpenVoting: () => void
  onJustify: (action: AgendaIncidentAction) => void
}) {
  const editableStatus = !['aprovado', 'rejeitado', 'retirado', 'adiado'].includes(item.status)
  const canStartVoting =
    canVote && votingAllowed && ['pendente', 'em_leitura', 'em_discussao'].includes(item.status)

  return (
    <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold tabular-nums">
          {num}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">{item.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {item.matterLabel && (
              <Badge variant="outline" className="font-mono text-[10px]">
                {item.matterLabel}
              </Badge>
            )}
            <AgendaStatusBadge status={item.status} />
            {item.resultSummary && (
              <span className={cn('text-xs', resultSummaryClass(item))}>{item.resultSummary}</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {canMove && (
          <>
            <Button
              size="icon"
              className="size-8"
              variant="ghost"
              disabled={firstInSection || busy}
              onClick={() => onMove(-1)}
              aria-label={`Mover "${item.title}" para cima`}
            >
              <ArrowUp />
            </Button>
            <Button
              size="icon"
              className="size-8"
              variant="ghost"
              disabled={lastInSection || busy}
              onClick={() => onMove(1)}
              aria-label={`Mover "${item.title}" para baixo`}
            >
              <ArrowDown />
            </Button>
          </>
        )}

        {canConduct && item.status === 'pendente' && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus('em_leitura')}>
            <BookOpen /> Em leitura
          </Button>
        )}
        {canConduct && item.status === 'em_leitura' && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus('em_discussao')}>
            <MessageSquareText /> Em discussão
          </Button>
        )}

        <Button size="sm" disabled={!canStartVoting} onClick={onOpenVoting} title={canStartVoting ? undefined : 'Sessão aberta necessária (e permissão voting.write)'}>
          <Gavel /> Iniciar votação
        </Button>

        {canRetire && editableStatus && (
          <ItemMenu
            onRetirar={() => onJustify('retirar')}
            onAdiar={() => onJustify('adiar')}
            onVista={canConduct ? () => onJustify('vista') : undefined}
            onDestaque={canConduct ? () => onJustify('destaque') : undefined}
            title={item.title}
          />
        )}
      </div>
    </div>
  )
}

function ItemMenu({
  onRetirar,
  onAdiar,
  onVista,
  onDestaque,
  title,
}: {
  onRetirar: () => void
  onAdiar: () => void
  onVista?: () => void
  onDestaque?: () => void
  title: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {onVista && (
        <Button size="sm" variant="ghost" onClick={onVista} aria-label={`Pedido de vista em ${title}`}>
          <Eye /> Vista
        </Button>
      )}
      {onDestaque && (
        <Button size="sm" variant="ghost" onClick={onDestaque} aria-label={`Destaque em ${title}`}>
          Destaque
        </Button>
      )}
      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onRetirar}>
        Retirar
      </Button>
      <Button size="sm" variant="ghost" onClick={onAdiar} aria-label={`Adiar ${title}`}>
        <CalendarClock /> Adiar
      </Button>
    </div>
  )
}

// ─── Dialog de configuração da votação ─────────────────────────────────────

/** Slug estável a partir do rótulo (mesma regra do servidor: [a-z0-9_]). */
function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

const KEY_RE = /^[a-z0-9_]{2,40}$/

function VotingSetupDialog({
  item,
  open,
  onOpenChange,
  sessionId,
  official,
  invalidate,
  onCreated,
}: {
  item: AgendaItemView | null
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  official: boolean
  invalidate: () => void
  onCreated: () => void
}) {
  const hideByDefault = useApp((s) => s.bootstrap?.tenant.settings.hidePartialByDefault ?? false)
  const configuredVotingPolicies = useApp((s) => s.bootstrap?.tenant.settings.votingPoliciesByMatterType ?? {})
  const votingPolicy = item?.matterType ? configuredVotingPolicies[item.matterType] : undefined
  const [question, setQuestion] = useState('')
  const [mode, setMode] = useState<VotingMode>('nominal')
  const [rule, setRule] = useState<VotingRule>('maioria_simples')
  const [hidePartial, setHidePartial] = useState(false)
  const [busy, setBusy] = useState(false)
  // Fase 18 — opções regimentais customizadas (1–5) que substituem Sim/Não/Abstenção
  const [useCustomOptions, setUseCustomOptions] = useState(false)
  const [customOptions, setCustomOptions] = useState<Array<{ key: string; label: string }>>([
    { key: '', label: '' },
    { key: '', label: '' },
  ])

  useEffect(() => {
    if (item) {
      setQuestion(item.title)
      setMode('nominal')
      setRule(votingPolicy?.rule ?? 'maioria_simples')
      setHidePartial(hideByDefault)
      setUseCustomOptions(false)
      setCustomOptions([
        { key: '', label: '' },
        { key: '', label: '' },
      ])
    }
  }, [item, hideByDefault, votingPolicy?.rule])

  const filledOptions = customOptions.filter((o) => o.label.trim().length > 0 || o.key.trim().length > 0)
  const optionsErrors: string[] = []
  if (useCustomOptions) {
    if (filledOptions.length < 1) optionsErrors.push('Informe ao menos 1 opção.')
    if (customOptions.length > 5) optionsErrors.push('Informe no máximo 5 opções.')
    const keys = filledOptions.map((o) => (o.key.trim() || slugify(o.label)))
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i)
    if (dup.length > 0) optionsErrors.push(`Chaves duplicadas: ${[...new Set(dup)].join(', ')}.`)
    for (const o of filledOptions) {
      const key = o.key.trim() || slugify(o.label)
      if (!KEY_RE.test(key))
        optionsErrors.push(`Chave inválida "${o.key || o.label}" — use 2–40 caracteres (a-z, 0-9, _).`)
      if (o.label.trim().length < 1) optionsErrors.push('Rótulo não pode ser vazio.')
      if (o.label.trim().length > 60) optionsErrors.push(`Rótulo "${o.label.slice(0, 20)}…" acima de 60 caracteres.`)
    }
  }
  const optionsValid = !useCustomOptions || optionsErrors.length === 0

  const updateOption = (i: number, patch: Partial<{ key: string; label: string }>) => {
    setCustomOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)))
  }

  const submit = async () => {
    if (!item) return
    setBusy(true)
    try {
      const options = useCustomOptions
        ? filledOptions.map((o) => ({ key: o.key.trim() || slugify(o.label), label: o.label.trim() }))
        : undefined
      await api.createVoting(sessionId, {
        agendaItemId: item.id,
        question: question.trim() || item.title,
        mode,
        rule,
        hidePartial,
        options: options && options.length > 0 ? options : undefined,
      })
      invalidate()
      toast.success(
        options && options.length > 0
          ? 'Votação criada com opções customizadas — configure a abertura na aba Votação.'
          : 'Votação criada — configure a abertura na aba Votação.'
      )
      onOpenChange(false)
      onCreated()
    } catch {
      // toast global
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto custom-scroll sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="size-5 text-primary" /> Configurar votação
          </DialogTitle>
          <DialogDescription>
            {item ? `Item: ${item.title}` : ''} — a votação nasce no status “Pronta” e é aberta na
            aba Votação.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="voting-question">Questão submetida à votação</Label>
            <Input
              id="voting-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={300}
            />
          </div>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Modo de votação</legend>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as VotingMode)} className="grid gap-2">
              {(Object.keys(VOTING_MODE_LABEL) as VotingMode[]).filter((m) => !official || m !== 'secreto').map((m) => (
                <Label
                  key={m}
                  htmlFor={`mode-${m}`}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition hover:bg-accent has-[button[data-state=checked]]:border-primary"
                >
                  <RadioGroupItem id={`mode-${m}`} value={m} className="mt-0.5" />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">{VOTING_MODE_LABEL[m]}</span>
                    <span className="text-xs font-normal text-muted-foreground">{VOTING_MODE_HINT[m]}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
            {official && <p className="text-xs text-muted-foreground">Voto secreto oficial indisponível até revisão independente da garantia de sigilo.</p>}
          </fieldset>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="voting-rule">Regra de aprovação</Label>
              <Select value={rule} disabled={!!votingPolicy} onValueChange={(v) => setRule(v as VotingRule)}>
                <SelectTrigger id="voting-rule" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(VOTING_RULE_LABEL) as VotingRule[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {VOTING_RULE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {votingPolicy && <p className="text-xs text-muted-foreground">Regra da Câmara para este tipo de matéria; quórum mínimo de {votingPolicy.quorumMinimum} presente(s).</p>}
            </div>
            <div className="flex items-end">
              <label htmlFor="hide-partial" className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border p-3">
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">Ocultar resultados parciais</span>
                  <span className="text-xs text-muted-foreground">A mesa vê apenas “registrou”.</span>
                </span>
                <Switch id="hide-partial" checked={hidePartial} onCheckedChange={setHidePartial} />
              </label>
            </div>
          </div>

          {/* Fase 18 — opções de resposta customizadas */}
          <fieldset className="grid gap-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-semibold">Opções de resposta</legend>
            <label htmlFor="custom-options" className="flex cursor-pointer items-center justify-between gap-3">
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">Usar opções regimentais customizadas</span>
                <span className="text-xs text-muted-foreground">
                  Substituem Sim/Não/Abstenção (até 5 opções; ex.: “Constar em ata”).
                </span>
              </span>
              <Switch
                id="custom-options"
                checked={useCustomOptions}
                onCheckedChange={setUseCustomOptions}
              />
            </label>

            {useCustomOptions && (
              <div className="grid gap-2">
                <p className="text-xs text-muted-foreground">
                  A chave é gerada automaticamente a partir do rótulo (slug minúsculo) e pode ser editada.
                </p>
                {customOptions.map((o, i) => {
                  const resolvedKey = o.key.trim() || slugify(o.label)
                  const keyInvalid = resolvedKey.length > 0 && !KEY_RE.test(resolvedKey)
                  const labelInvalid = o.label.trim().length > 60
                  return (
                    <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] items-start gap-2">
                      <div className="grid gap-1">
                        <Label htmlFor={`opt-key-${i}`} className="sr-only">
                          Chave da opção {i + 1}
                        </Label>
                        <Input
                          id={`opt-key-${i}`}
                          value={o.key}
                          onChange={(e) => updateOption(i, { key: e.target.value })}
                          placeholder={slugify(o.label) || 'chave_slug'}
                          className="font-mono text-xs"
                          maxLength={40}
                          aria-label={`Chave da opção ${i + 1}`}
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor={`opt-label-${i}`} className="sr-only">
                          Rótulo da opção {i + 1}
                        </Label>
                        <Input
                          id={`opt-label-${i}`}
                          value={o.label}
                          onChange={(e) => updateOption(i, { label: e.target.value })}
                          placeholder={`Ex.: Opção regimental ${i + 1}`}
                          maxLength={80}
                          aria-label={`Rótulo da opção ${i + 1}`}
                        />
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-9 text-destructive hover:text-destructive"
                        disabled={customOptions.length <= 1}
                        onClick={() => setCustomOptions((prev) => prev.filter((_, idx) => idx !== i))}
                        aria-label={`Remover opção ${i + 1}`}
                      >
                        <Trash2 />
                      </Button>
                      {(keyInvalid || labelInvalid) && (
                        <p className="col-span-3 text-xs text-destructive">
                          {keyInvalid && 'Chave inválida (2–40 caracteres: a-z, 0-9, _). '}
                          {labelInvalid && 'Rótulo acima de 60 caracteres.'}
                        </p>
                      )}
                    </div>
                  )
                })}
                {customOptions.length < 5 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => setCustomOptions((prev) => [...prev, { key: '', label: '' }])}
                  >
                    <Plus /> Adicionar opção
                  </Button>
                )}
                {optionsErrors.length > 0 && (
                  <ul className="grid gap-0.5 text-xs text-destructive" role="alert">
                    {optionsErrors.map((e) => (
                      <li key={e}>• {e}</li>
                    ))}
                  </ul>
                )}
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ListChecks className="size-3.5" aria-hidden /> Apuração: a opção mais votada vence conforme a
                  regra; contagens por rótulo no telão e recibos verificáveis no encerramento (nominal).
                </p>
              </div>
            )}
          </fieldset>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !question.trim() || !optionsValid}>
            {busy ? 'Criando…' : 'Criar votação'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Dialog de justificativa (retirar / adiar) ─────────────────────────────

function JustifyDialog({
  target,
  onOpenChange,
  onConfirm,
  busy,
}: {
  target: { item: AgendaItemView; action: AgendaIncidentAction } | null
  onOpenChange: (open: boolean) => void
  onConfirm: (justification: string) => void
  busy: boolean
}) {
  const [justification, setJustification] = useState('')

  const LABELS: Record<AgendaIncidentAction, { title: string; cta: string }> = {
    retirar: { title: 'Retirar o item da pauta', cta: 'Retirar item' },
    adiar: { title: 'Adiar o item para sessão futura', cta: 'Adiar item' },
    vista: { title: 'Conceder pedido de vista', cta: 'Registrar vista' },
    destaque: { title: 'Registrar destaque regimental', cta: 'Registrar destaque' },
  }
  const meta = target ? LABELS[target.action] : LABELS.retirar
  const minLen = target && ['vista', 'destaque'].includes(target.action) ? 5 : 3
  const valid = justification.trim().length >= minLen

  return (
    <AlertDialog open={!!target} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{meta.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            {target ? target.item.title : ''} — a justificativa é registrada em auditoria.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="agenda-justification">
            Justificativa <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="agenda-justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Ex.: A pedido do autor / vereador para análise ou votação em separado…"
          />
          {justification.trim().length > 0 && !valid && (
            <p className="text-xs text-destructive">Informe ao menos {minLen} caracteres.</p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction disabled={!valid || busy} onClick={(e) => { e.preventDefault(); onConfirm(justification.trim()) }}>
            {meta.cta}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ─── Dialog de adicionar matérias ──────────────────────────────────────────

function AddMattersDialog({
  open,
  onOpenChange,
  sessionId,
  existingMatterIds,
  invalidate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  existingMatterIds: Set<string>
  invalidate: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['matters', 'em_tramitacao'],
    queryFn: () => api.listMatters({ status: 'em_tramitacao' }),
    enabled: open,
  })

  useEffect(() => {
    if (open) setSelected(new Set())
  }, [open])

  const matters = (data?.matters ?? []).filter((m) => !existingMatterIds.has(m.id))

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = async () => {
    if (selected.size === 0) return
    setBusy(true)
    try {
      await api.addAgenda(sessionId, Array.from(selected))
      invalidate()
      toast.success(`${selected.size} matéria(s) adicionada(s) à Ordem do Dia.`)
      onOpenChange(false)
    } catch {
      // toast global
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-5 text-primary" /> Adicionar matérias à pauta
          </DialogTitle>
          <DialogDescription>
            Matérias em tramitação não incluídas nesta pauta. Elas entram na Ordem do Dia.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto custom-scroll rounded-lg border p-2">
          {isLoading ? (
            <div className="grid gap-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : matters.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              Nenhuma matéria em tramitação disponível.
            </p>
          ) : (
            <ul className="grid gap-1">
              {matters.map((m) => (
                <li key={m.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2.5 transition hover:bg-accent">
                    <Checkbox
                      checked={selected.has(m.id)}
                      onCheckedChange={() => toggle(m.id)}
                      className="mt-1"
                      aria-label={`Selecionar ${matterFullLabel(m.type, m.number, m.year)}`}
                    />
                    <span className="min-w-0 grid gap-0.5">
                      <span className="text-sm font-medium">
                        {matterFullLabel(m.type, m.number, m.year)}
                        {m.regime === 'urgencia' && (
                          <Badge variant="outline" className="ml-2 border-amber-500/50 text-[10px] text-amber-700 dark:text-amber-400">
                            Urgência
                          </Badge>
                        )}
                      </span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">{m.ementa}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {selected.size} selecionada(s)
            <Eye className="ml-2 inline size-3.5" aria-hidden />
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void submit()} disabled={busy || selected.size === 0}>
              {busy ? 'Adicionando…' : 'Adicionar à pauta'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
