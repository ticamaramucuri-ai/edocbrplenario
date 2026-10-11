'use client'

/**
 * Drawer (Sheet) de detalhe da matéria — dados completos, timeline de tramitação
 * (append-only, ícone por ação), mini-seções Versões e Anexos (listar + criar) e
 * botão "Registrar andamento". Compartilhado entre os módulos Workflow e Matérias.
 * Fase 7: botões "Sugerir ementa (IA)" e "Resumir tramitação (IA)" — resultado em
 * bloco destacado com badge de rascunho; NUNCA aplicado automaticamente (aplicação
 * manual pelo administrador + botão copiar).
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Archive,
  ArchiveRestore,
  CalendarPlus,
  Copy,
  FileCheck2,
  FilePlus2,
  FileText,
  Gavel,
  GitBranch,
  History,
  Link2,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Sparkles,
  Stamp,
  Upload,
  XOctagon,
} from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDateTime } from '@/lib/format'
import {
  MATTER_ATTACHMENT_KIND_LABEL,
  MATTER_STATUS_LABEL,
  MATTER_TYPE_LABEL,
  PROCEEDING_ACTION_LABEL,
  type AiArtifactView,
  type EmentaSuggestion,
  type MatterView,
  type ProceedingsSummary,
} from '@/lib/contracts'
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ProceedingDialog, MATTER_TERMINALS } from './proceeding-dialog'
import MatterLifecycleSections from '@/modules/matters/lifecycle-sections'

const ACTION_ICONS: Record<string, React.ReactNode> = {
  despacho: <FileText className="size-4" />,
  parecer: <FileCheck2 className="size-4" />,
  emenda: <FilePlus2 className="size-4" />,
  inclusao_pauta: <CalendarPlus className="size-4" />,
  sessao: <Gavel className="size-4" />,
  sanco: <Stamp className="size-4" />,
  veto: <XOctagon className="size-4" />,
  arquivamento: <Archive className="size-4" />,
  desarquivamento: <ArchiveRestore className="size-4" />,
  outro: <MoreHorizontal className="size-4" />,
}

export function MatterStatusBadge({ status }: { status: string }) {
  if (status === 'aprovado')
    return <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600"><FileCheck2 className="size-3" />{MATTER_STATUS_LABEL.aprovado}</Badge>
  if (status === 'rejeitado')
    return <Badge className="gap-1 bg-rose-600 text-white hover:bg-rose-600"><XOctagon className="size-3" />{MATTER_STATUS_LABEL.rejeitado}</Badge>
  if (status === 'arquivado')
    return <Badge variant="outline" className="gap-1 text-muted-foreground"><Archive className="size-3" />{MATTER_STATUS_LABEL.arquivado}</Badge>
  // Fase 17 — desfechos finais: sanção (verde-escuro) e veto (vermelho/rust).
  if (status === 'sancionado')
    return <Badge className="gap-1 bg-emerald-800 text-white hover:bg-emerald-800"><Stamp className="size-3" />{MATTER_STATUS_LABEL.sancionado}</Badge>
  if (status === 'vetado')
    return <Badge className="gap-1 bg-red-800 text-white hover:bg-red-800"><XOctagon className="size-3" />{MATTER_STATUS_LABEL.vetado}</Badge>
  return <Badge variant="outline" className="gap-1"><History className="size-3" />{MATTER_STATUS_LABEL[status as keyof typeof MATTER_STATUS_LABEL] ?? status}</Badge>
}

// ─── Fase 7: sugestões de IA (rascunho; aplicação SEMPRE manual) ───────────

function AiDraftHeader({ artifact }: { artifact: AiArtifactView }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <Badge variant="secondary" className="gap-1">
        <Sparkles className="size-3" /> Rascunho de IA
      </Badge>
      <Badge variant="outline" className="font-mono">{artifact.model}</Badge>
      <span>{new Date(artifact.createdAt).toLocaleString('pt-BR')}</span>
      <span aria-hidden>·</span>
      <span>aplicação manual pelo administrador</span>
    </div>
  )
}

function AiSuggestionsSection({ matter }: { matter: MatterView }) {
  const can = useApp((s) => s.can)
  const canUse = can('ai.use')

  const [ementa, setEmenta] = useState<{ artifact: AiArtifactView; output: EmentaSuggestion } | null>(null)
  const [summary, setSummary] = useState<{ artifact: AiArtifactView; output: ProceedingsSummary } | null>(null)

  const ementaMutation = useMutation({
    mutationFn: () => api.aiEmenta({ matterId: matter.id }),
    onSuccess: (res) => {
      setEmenta(res)
      toast.success('Ementa sugerida por IA', {
        description: 'Rascunho registrado — aplicação manual pelo administrador.',
      })
    },
  })
  const summaryMutation = useMutation({
    mutationFn: () => api.aiProceedingsSummary(matter.id),
    onSuccess: (res) => {
      setSummary(res)
      toast.success('Resumo de tramitação gerado', {
        description: 'Rascunho de apoio — não substitui a timeline oficial.',
      })
    },
  })

  const copy = (text: string, label: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success('Copiado', { description: label }))
      .catch(() => toast.error('Não foi possível copiar', { description: 'Copie manualmente o texto exibido.' }))
  }

  if (!canUse) return null

  return (
    <section aria-label="Assistência de IA" className="space-y-3 border-b p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" /> Assistência de IA
        </h4>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => ementaMutation.mutate()}
            disabled={ementaMutation.isPending || summaryMutation.isPending}
          >
            {ementaMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {ementaMutation.isPending ? 'Gerando…' : 'Sugerir ementa (IA)'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => summaryMutation.mutate()}
            disabled={ementaMutation.isPending || summaryMutation.isPending}
          >
            {summaryMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {summaryMutation.isPending ? 'Resumindo…' : 'Resumir tramitação (IA)'}
          </Button>
        </div>
      </div>

      {ementa && (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/[0.04] p-3">
          <AiDraftHeader artifact={ementa.artifact} />
          <p className="text-sm leading-relaxed">{ementa.output.ementaSugerida}</p>
          {ementa.output.temas.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {ementa.output.temas.map((t) => (
                <Badge key={t} variant="secondary" className="text-[11px] font-normal">{t}</Badge>
              ))}
            </div>
          )}
          {ementa.output.justificativa && (
            <p className="text-xs italic text-muted-foreground">{ementa.output.justificativa}</p>
          )}
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => copy(ementa.output.ementaSugerida, 'Ementa sugerida copiada para a área de transferência.')}>
            <Copy className="size-3.5" /> Copiar ementa sugerida
          </Button>
        </div>
      )}

      {summary && (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/[0.04] p-3">
          <AiDraftHeader artifact={summary.artifact} />
          <p className="text-sm leading-relaxed">{summary.output.resumo}</p>
          {summary.output.proximosPassos.length > 0 && (
            <div>
              <p className="text-xs font-semibold">Próximos passos sugeridos:</p>
              <ul className="ml-4 list-disc space-y-0.5 text-sm text-muted-foreground">
                {summary.output.proximosPassos.map((p, i) => (
                  <li key={`${i}-${p.slice(0, 12)}`}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => copy(summary.output.resumo, 'Resumo da tramitação copiado.')}>
            <Copy className="size-3.5" /> Copiar resumo
          </Button>
        </div>
      )}

      {!ementa && !summary && !ementaMutation.isPending && !summaryMutation.isPending && (
        <p className="text-xs text-muted-foreground">
          Sugestões sempre como rascunho com origem (modelo/horário) visível — nenhum texto é
          aplicado automaticamente à matéria.
        </p>
      )}
    </section>
  )
}

export default function MatterDrawer({
  matter,
  onOpenChange,
}: {
  matter: MatterView | null
  onOpenChange: () => void
}) {
  const can = useApp((s) => s.can)
  const canWrite = can('matter.write')
  const [proceedingOpen, setProceedingOpen] = useState(false)
  const [versionOpen, setVersionOpen] = useState(false)
  const [attachmentOpen, setAttachmentOpen] = useState(false)

  const proceedingsQ = useQuery({
    queryKey: ['proceedings', matter?.id],
    queryFn: () => api.listProceedings(matter!.id),
    enabled: !!matter,
  })
  const versionsQ = useQuery({
    queryKey: ['matter-versions', matter?.id],
    queryFn: () => api.listMatterVersions(matter!.id),
    enabled: !!matter,
  })
  const attachmentsQ = useQuery({
    queryKey: ['matter-attachments', matter?.id],
    queryFn: () => api.listMatterAttachments(matter!.id),
    enabled: !!matter,
  })

  const proceedings = proceedingsQ.data?.proceedings ?? []
  const versions = versionsQ.data?.versions ?? []
  const attachments = attachmentsQ.data?.attachments ?? []
  const terminal = matter ? MATTER_TERMINALS.includes(matter.status) : false

  return (
    <Sheet open={!!matter} onOpenChange={(v) => !v && onOpenChange()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto custom-scroll p-0 sm:max-w-xl"
      >
        {matter && (
          <>
            <SheetHeader className="border-b p-4">
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-bold uppercase">{matter.type.replace(/_/g, ' ')} {matter.number}/{matter.year}</span>
                <MatterStatusBadge status={matter.status} />
                {matter.regime === 'urgencia' && (
                  <Badge className="gap-1 bg-amber-600 text-white hover:bg-amber-600">Urgência</Badge>
                )}
              </SheetTitle>
              <SheetDescription>
                {MATTER_TYPE_LABEL[matter.type] ?? matter.type} · autores: {matter.authors.join(', ') || '—'} · criada
                em {fmtDateTime(matter.createdAt)}
              </SheetDescription>
            </SheetHeader>

            {/* Ementa */}
            <section aria-label="Ementa" className="border-b p-4">
              <p className="text-sm leading-relaxed">{matter.ementa}</p>
            </section>

            {/* Fase 7 — sugestões de IA (rascunho, aplicação manual) */}
            <AiSuggestionsSection matter={matter} />

            {/* Timeline */}
            <section aria-label="Tramitação" className="space-y-3 border-b p-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <GitBranch className="size-4 text-primary" /> Tramitação
                  <span className="font-normal text-muted-foreground">({proceedings.length} andamentos)</span>
                </h4>
                {canWrite && !terminal && (
                  <Button size="sm" onClick={() => setProceedingOpen(true)}>
                    <GitBranch className="size-3.5" /> Registrar andamento
                  </Button>
                )}
                {terminal && (
                  <p className="max-w-52 text-right text-[11px] text-muted-foreground">
                    Situação terminal — novos andamentos exigem anulação formal de sessão.
                  </p>
                )}
              </div>

              {proceedingsQ.isLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : proceedings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sem andamentos registrados — a matéria ainda não tramitou.
                </p>
              ) : (
                <ol className="relative space-y-0" aria-label="Timeline de tramitação">
                  {proceedings.map((p, idx) => (
                    <li key={p.id} className="relative flex gap-3 pb-4">
                      {idx < proceedings.length - 1 && (
                        <span className="absolute left-[15px] top-8 h-full w-px bg-border" aria-hidden />
                      )}
                      <span
                        className={cn(
                          'z-10 flex size-8 shrink-0 items-center justify-center rounded-full border',
                          p.toStatus !== p.fromStatus
                            ? 'border-primary/40 bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground'
                        )}
                        aria-hidden
                      >
                        {ACTION_ICONS[p.action] ?? <MoreHorizontal className="size-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <p className="text-sm font-semibold">
                            {PROCEEDING_ACTION_LABEL[p.action] ?? p.action}
                          </p>
                          <span className="font-mono text-[11px] text-muted-foreground">seq {p.seq}</span>
                          {p.toStatus !== p.fromStatus && (
                            <Badge variant="secondary" className="gap-1 text-[11px]">
                              {MATTER_STATUS_LABEL[p.fromStatus as keyof typeof MATTER_STATUS_LABEL]} →{' '}
                              {MATTER_STATUS_LABEL[p.toStatus as keyof typeof MATTER_STATUS_LABEL]}
                            </Badge>
                          )}
                        </div>
                        {p.notes && <p className="mt-0.5 text-xs text-muted-foreground">{p.notes}</p>}
                        <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                          <span>{fmtDateTime(p.createdAt)}</span>
                          <span>
                            por {p.actorName}
                          </span>
                          {p.documentRef && <span className="font-mono">· {p.documentRef}</span>}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* Versões */}
            <section aria-label="Versões do texto" className="space-y-3 border-b p-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <FileText className="size-4 text-primary" /> Versões do texto
                  <span className="font-normal text-muted-foreground">({versions.length})</span>
                </h4>
                {canWrite && (
                  <Button size="sm" variant="outline" onClick={() => setVersionOpen(true)}>
                    <FilePlus2 className="size-3.5" /> Nova versão
                  </Button>
                )}
              </div>
              {versionsQ.isLoading ? (
                <Skeleton className="h-12 w-full" />
              ) : versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma versão registrada.</p>
              ) : (
                <ul className="max-h-56 space-y-2 overflow-y-auto custom-scroll pr-1">
                  {versions.map((v) => (
                    <li key={v.id} className="rounded-lg border p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">Versão nº {v.version}</p>
                        <span className="text-[11px] text-muted-foreground">{fmtDateTime(v.createdAt)}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{v.text}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">Autor: {v.authorName}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Anexos */}
            <section aria-label="Anexos" className="space-y-3 border-b p-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <Paperclip className="size-4 text-primary" /> Anexos
                  <span className="font-normal text-muted-foreground">({attachments.length})</span>
                </h4>
                {canWrite && (
                  <Button size="sm" variant="outline" onClick={() => setAttachmentOpen(true)}>
                    <Upload className="size-3.5" /> Registrar anexo
                  </Button>
                )}
              </div>
              {attachmentsQ.isLoading ? (
                <Skeleton className="h-12 w-full" />
              ) : attachments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum anexo registrado (metadados).</p>
              ) : (
                <ul className="max-h-56 space-y-2 overflow-y-auto custom-scroll pr-1">
                  {attachments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          <Paperclip className="mr-1 inline size-3.5 text-muted-foreground" aria-hidden />
                          {a.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {MATTER_ATTACHMENT_KIND_LABEL[a.kind] ?? a.kind} ·{' '}
                          {a.sizeBytes > 0 ? `${Math.round(a.sizeBytes / 1024)} KB` : 'sem tamanho'} ·{' '}
                          {fmtDateTime(a.createdAt)}
                        </p>
                      </div>
                      {a.url && (
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                        >
                          <Link2 className="size-3.5" aria-hidden /> Abrir
                        </a>
                      )}
                      {!a.url && <span className="text-xs text-muted-foreground">Arquivo não disponível</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Fase 17 — ciclo de vida: relacionamentos + desfecho (sanção/veto) */}
            <MatterLifecycleSections matter={matter} />
          </>
        )}
      </SheetContent>

      {/* Dialogs */}
      <ProceedingDialog matter={matter} open={proceedingOpen} onOpenChange={setProceedingOpen} />
      {matter && (
        <>
          <NewVersionDialog matter={matter} open={versionOpen} onOpenChange={setVersionOpen} />
          <NewAttachmentDialog matter={matter} open={attachmentOpen} onOpenChange={setAttachmentOpen} />
        </>
      )}
    </Sheet>
  )
}

function NewVersionDialog({
  matter,
  open,
  onOpenChange,
}: {
  matter: MatterView
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      api.createMatterVersion(matter.id, { text: text.trim(), authorName: authorName.trim() || undefined }),
    onSuccess: (res) => {
      toast.success('Versão registrada', { description: `Versão nº ${res.version.version} de ${res.version.authorName}` })
      queryClient.invalidateQueries({ queryKey: ['matter-versions', matter.id] })
      setText('')
      setAuthorName('')
      setError(null)
      onOpenChange(false)
    },
  })

  const submit = () => {
    if (text.trim().length < 10) {
      setError('O texto da versão deve ter ao menos 10 caracteres.')
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova versão do texto</DialogTitle>
          <DialogDescription>
            A numeração é automática (última versão + 1). O texto integral é versionado — nada é sobrescrito.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="version-text">Texto integral *</Label>
            <Textarea
              id="version-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="Cole ou digite o texto integral da matéria…"
              aria-invalid={!!error}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="version-author">Autor da versão</Label>
            <Input
              id="version-author"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="Padrão: seu perfil ativo"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Registrando…' : 'Registrar versão'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NewAttachmentDialog({
  matter,
  open,
  onOpenChange,
}: {
  matter: MatterView
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [kind, setKind] = useState('anexo')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      api.createMatterAttachment(matter.id, {
        name: name.trim(),
        kind,
        url: url.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Anexo registrado', { description: name.trim() })
      queryClient.invalidateQueries({ queryKey: ['matter-attachments', matter.id] })
      setName('')
      setKind('anexo')
      setUrl('')
      setError(null)
      onOpenChange(false)
    },
  })

  const submit = () => {
    if (name.trim().length < 3) {
      setError('Informe o nome do anexo.')
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar anexo</DialogTitle>
          <DialogDescription>
            Metadados apenas (o armazenamento do arquivo é externo). Informe a URL quando disponível.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="att-name">Nome *</Label>
            <Input id="att-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Parecer CCJ nº 12 — PDF" aria-invalid={!!error} />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="att-kind">Espécie</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger id="att-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MATTER_ATTACHMENT_KIND_LABEL).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="att-url">URL (opcional)</Label>
            <Input id="att-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Registrando…' : 'Registrar anexo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
