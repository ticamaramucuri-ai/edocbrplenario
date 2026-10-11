'use client'

/**
 * Módulo Modelos de Documento (Fase 14) — templates versionados por tenant
 * com placeholders `{{token}}`, preview renderizado no servidor e histórico
 * append-only (versões nunca são editadas/apagadas; restaurar cria versão nova).
 *
 * - Tabela: nome, tipo (badge), versão atual, ativo e última alteração
 *   (autor + data); ações Editar / Nova versão / Histórico / Preview /
 *   Desativar-Ativar (AlertDialog).
 * - Dialog criar/editar: corpo Markdown com painel de placeholders clicáveis
 *   (inserem o token na posição do cursor) e Tabs Editor|Preview.
 * - Dialog histórico: timeline de versões com restauração confirmada.
 * - Dialog preview: render no SERVIDOR (POST /templates/:id/render) com aviso
 *   de tokens não resolvidos.
 *
 * Escrita escondida sem can('template.write'); leitura para todos os papéis.
 * Fetch local com x-actor-id do localStorage (convivência com o modo demo).
 */
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import Markdown from 'react-markdown'
import { toast } from 'sonner'
import {
  Eye,
  FileStack,
  FilePlus2,
  History,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  Variable,
} from 'lucide-react'

import { useApp } from '@/lib/store'
import {
  TEMPLATE_KIND_LABEL,
  TEMPLATE_PLACEHOLDERS,
  type TemplateKind,
} from '@/lib/contracts'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/modules/_shared'
import { cn } from '@/lib/utils'

// ─── Fetch local (api-client.ts intocável) ─────────────────────────────────

type Problem = {
  title?: string
  detail?: string
  status?: number
  code?: string
  errors?: Record<string, string[]>
}

class TplApiError extends Error {
  constructor(public readonly problem: Problem) {
    super(problem.detail || problem.title || 'Erro na requisição.')
    this.name = 'TplApiError'
  }
}

/** fetch + JSON + Problem Details; injeta x-actor-id do modo demo. */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body !== undefined) headers.set('Content-Type', 'application/json')
  const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
  if (actorId) headers.set('x-actor-id', actorId)
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  const text = await res.text()
  const body: unknown = text ? JSON.parse(text) : null
  if (!res.ok) throw new TplApiError((body ?? {}) as Problem)
  return body as T
}

function problemMessage(err: unknown): string {
  if (err instanceof TplApiError) {
    const fields = err.problem.errors
      ? Object.values(err.problem.errors).flat().filter(Boolean).join(' ')
      : ''
    return [err.problem.detail, fields].filter(Boolean).join(' — ')
  }
  return err instanceof Error ? err.message : 'Erro inesperado.'
}

// ─── Tipos e helpers ────────────────────────────────────────────────────────

type TemplateRow = {
  id: string
  name: string
  kind: TemplateKind
  description: string | null
  active: boolean
  currentVersion: number
  createdAt: string
  updatedAt: string
  lastVersion: { authorName: string; changeNote: string | null; createdAt: string } | null
}

type TemplateVersionRow = {
  id: string
  version: number
  changeNote: string | null
  authorName: string
  createdAt: string
}

type TemplateDetailRow = Omit<TemplateRow, 'lastVersion'> & {
  bodyMd: string
  versions: TemplateVersionRow[]
}

type RenderResponse = {
  rendered: string
  unresolved: string[]
  templateId: string
  version: number
}

const KIND_OPTIONS: Array<{ value: TemplateKind; label: string }> = (
  Object.keys(TEMPLATE_KIND_LABEL) as TemplateKind[]
).map((k) => ({ value: k, label: TEMPLATE_KIND_LABEL[k] }))

const kindLabel = (k: string) => TEMPLATE_KIND_LABEL[k as TemplateKind] ?? k

const fmtDateTime = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "d 'de' MMM 'de' yyyy 'às' HH:mm", { locale: ptBR }) : '—'

/** Conteúdo Markdown simples para previews. */
function MarkdownContent({ children }: { children: string }) {
  if (!children.trim()) {
    return <p className="text-sm italic text-muted-foreground">Modelo sem conteúdo.</p>
  }
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      <Markdown
        components={{
          h1: ({ node: _n, ...props }) => <h3 className="text-base font-bold" {...props} />,
          h2: ({ node: _n, ...props }) => <h3 className="text-base font-bold" {...props} />,
          h3: ({ node: _n, ...props }) => <h4 className="font-semibold" {...props} />,
          ul: ({ node: _n, ...props }) => <ul className="list-disc space-y-1 pl-5" {...props} />,
          ol: ({ node: _n, ...props }) => <ol className="list-decimal space-y-1 pl-5" {...props} />,
          p: ({ node: _n, ...props }) => <p className="leading-relaxed" {...props} />,
          strong: ({ node: _n, ...props }) => <strong className="font-semibold" {...props} />,
        }}
      >
        {children}
      </Markdown>
    </div>
  )
}

// ─── Dialog criar/editar ────────────────────────────────────────────────────

type FormDialogState =
  | { mode: 'create' }
  | { mode: 'edit'; template: TemplateRow }

/**
 * Dialog de criação/edição: corpo Markdown com painel de placeholders
 * clicáveis (inserem o token na posição do cursor) e Tabs Editor|Preview.
 * Editando: alteração de corpo SEMPRE gera nova versão — changeNote
 * obrigatório quando o corpo mudou.
 */
function TemplateFormDialog({ state, onClose }: { state: FormDialogState; onClose: () => void }) {
  const qc = useQueryClient()
  const editing = state.mode === 'edit' ? state.template : null
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const detailQ = useQuery({
    queryKey: ['template-detail', editing?.id],
    queryFn: () =>
      apiFetch<{ template: TemplateDetailRow }>(`/api/v1/templates/${editing!.id}`),
    enabled: !!editing,
  })

  const [name, setName] = useState('')
  const [kind, setKind] = useState<TemplateKind>('ata_sessao')
  const [description, setDescription] = useState('')
  const [bodyMd, setBodyMd] = useState('')
  const [changeNote, setChangeNote] = useState('')
  const [tab, setTab] = useState('editor')

  // Popula o formulário quando o detalhe chega (modo edição) — reset
  // derivado no render. O guarda usa o ID DO ALVO (não do detalhe): com cache
  // quente o detalhe já está disponível no primeiro render e a população
  // precisa acontecer mesmo assim (a cada abertura do diálogo).
  const detail = detailQ.data?.template
  const [populatedFor, setPopulatedFor] = useState<string | null>(null)
  if (editing && detail && populatedFor !== editing.id) {
    setPopulatedFor(editing.id)
    setName(detail.name)
    setKind(detail.kind)
    setDescription(detail.description ?? '')
    setBodyMd(detail.bodyMd)
    setChangeNote('')
  }

  const bodyChanged = !!detail && bodyMd !== detail.bodyMd
  const metaChanged =
    !!detail && (name.trim() !== detail.name || (description.trim() || null) !== detail.description)
  const nothingChanged = !!editing && !bodyChanged && !metaChanged

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) {
        return apiFetch<{ template: TemplateRow }>('/api/v1/templates', {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            kind,
            ...(description.trim() ? { description: description.trim() } : {}),
            bodyMd,
            ...(changeNote.trim() ? { changeNote: changeNote.trim() } : {}),
          }),
        })
      }
      // Edição: metadados (PATCH edit) e/ou nova versão (PATCH new_version).
      if (metaChanged) {
        await apiFetch<{ template: TemplateRow }>(`/api/v1/templates/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'edit',
            name: name.trim(),
            description: description.trim() || null,
          }),
        })
      }
      if (bodyChanged) {
        return apiFetch<{ template: TemplateRow }>(`/api/v1/templates/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'new_version',
            bodyMd,
            ...(changeNote.trim() ? { changeNote: changeNote.trim() } : {}),
          }),
        })
      }
      return Promise.resolve({ template: { id: editing.id } as TemplateRow })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['templates'] })
      if (editing) void qc.invalidateQueries({ queryKey: ['template-detail', editing.id] })
      toast.success(editing ? 'Modelo atualizado' : 'Modelo criado', {
        description: editing
          ? bodyChanged
            ? `Nova versão v${editing.currentVersion + 1} registrada — histórico append-only preservado.`
            : 'Metadados atualizados com auditoria.'
          : 'Modelo criado na versão v1 — já disponível para novas publicações.',
      })
      onClose()
    },
    onError: (err) => toast.error('Falha ao salvar modelo', { description: problemMessage(err) }),
  })

  /** Insere o token na posição do cursor do textarea (ou no fim). */
  function insertToken(token: string) {
    if (tab !== 'editor') {
      setTab('editor')
      setBodyMd((prev) => prev + token)
      return
    }
    const el = textareaRef.current
    if (!el) {
      setBodyMd((prev) => prev + token)
      return
    }
    const start = el.selectionStart ?? bodyMd.length
    const end = el.selectionEnd ?? bodyMd.length
    const next = bodyMd.slice(0, start) + token + bodyMd.slice(end)
    setBodyMd(next)
    requestAnimationFrame(() => {
      const el2 = textareaRef.current
      if (el2) {
        el2.focus()
        el2.setSelectionRange(start + token.length, start + token.length)
      }
    })
  }

  const nameValid = name.trim().length >= 3 && name.trim().length <= 120
  const descValid = description.length <= 300
  const bodyValid = bodyMd.trim().length >= 1 && bodyMd.length <= 50000
  const noteValid = changeNote.length <= 200 && (!bodyChanged || changeNote.trim().length > 0)
  const canSave =
    nameValid &&
    descValid &&
    bodyValid &&
    noteValid &&
    !save.isPending &&
    !nothingChanged &&
    (!editing || !!detailQ.data)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto custom-scroll sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileStack className="size-5 text-primary" />
            {editing ? `Editar modelo — ${editing.name}` : 'Novo modelo de documento'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? 'Alterações no corpo SEMPRE criam uma nova versão (histórico append-only). A nota de mudança é obrigatória quando o corpo mudar.'
              : 'Padronize atas, decretos, resoluções, portarias, editais e ofícios com placeholders preenchidos na criação de publicações.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Nome (3 a 120 caracteres)</Label>
              <Input
                id="tpl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Ata de Sessão Ordinária"
                aria-invalid={!nameValid}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-kind">Tipo</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as TemplateKind)} disabled={!!editing}>
                <SelectTrigger id="tpl-kind" aria-label="Tipo do modelo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-description">Descrição (opcional, máx. 300)</Label>
            <Input
              id="tpl-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Para que serve este modelo"
              maxLength={300}
              aria-invalid={!descValid}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
            <div className="min-w-0 space-y-3">
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                  <TabsTrigger value="editor">Editor</TabsTrigger>
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                </TabsList>
                <TabsContent value="editor" className="mt-2 space-y-1.5">
                  <Label htmlFor="tpl-body" className="sr-only">
                    Corpo do modelo em Markdown
                  </Label>
                  <Textarea
                    id="tpl-body"
                    ref={textareaRef}
                    value={bodyMd}
                    onChange={(e) => setBodyMd(e.target.value)}
                    placeholder="Corpo do documento em Markdown — use os placeholders ao lado…"
                    className="min-h-72 font-mono text-[13px] leading-relaxed custom-scroll"
                    aria-invalid={!bodyValid}
                    aria-describedby="tpl-body-hint"
                  />
                  <p id="tpl-body-hint" className="text-xs text-muted-foreground">
                    Markdown puro. Tokens{' '}
                    <code className="rounded bg-muted px-1">{ '{{camara}}' }</code> são resolvidos no
                    servidor na criação de publicações; desconhecidos permanecem para revisão.
                  </p>
                </TabsContent>
                <TabsContent value="preview" className="mt-2">
                  <div className="max-h-80 overflow-y-auto custom-scroll rounded-lg border bg-muted/30 p-4">
                    <MarkdownContent>{bodyMd}</MarkdownContent>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            {/* Painel de placeholders — acima do editor em mobile */}
            <aside
              aria-label="Placeholders disponíveis"
              className="order-first rounded-lg border bg-muted/40 p-3 lg:order-last"
            >
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Variable className="size-3.5" aria-hidden /> Placeholders
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Clique para inserir na posição do cursor:
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {TEMPLATE_PLACEHOLDERS.map((p) => (
                  <button
                    key={p.token}
                    type="button"
                    onClick={() => insertToken(p.token)}
                    title={p.description}
                    className="rounded-md border bg-background px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-primary"
                  >
                    {p.token}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                Sessão/matéria são resolvidos quando a publicação é vinculada a elas.
              </p>
            </aside>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-note">
              {editing
                ? `Nota de mudança${bodyChanged ? ' (obrigatória — o corpo mudou)' : ' (opcional — só para nova versão)'}`
                : 'Nota de mudança (opcional)'}
            </Label>
            <Input
              id="tpl-note"
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="Ex.: Cabeçalho dinâmico com número/tipo da sessão"
              maxLength={200}
              aria-invalid={!noteValid}
            />
            {editing && bodyChanged && changeNote.trim().length === 0 && (
              <p className="text-xs text-destructive">
                Informe uma nota de mudança para registrar a nova versão.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={!canSave}>
            {save.isPending && <RefreshCw className="animate-spin" />}
            {editing ? (bodyChanged ? 'Salvar nova versão' : 'Salvar alterações') : 'Criar modelo (v1)'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Dialog histórico (timeline + restaurar) ────────────────────────────────

/** Timeline de versões com botão Restaurar (AlertDialog) por versão. */
function TemplateHistoryDialog({ template, onClose }: { template: TemplateRow; onClose: () => void }) {
  const qc = useQueryClient()
  const [restoreTarget, setRestoreTarget] = useState<TemplateVersionRow | null>(null)

  const detailQ = useQuery({
    queryKey: ['template-detail', template.id],
    queryFn: () => apiFetch<{ template: TemplateDetailRow }>(`/api/v1/templates/${template.id}`),
  })
  const detail = detailQ.data?.template ?? null

  const restore = useMutation({
    mutationFn: (version: number) =>
      apiFetch<{ template: TemplateRow }>(`/api/v1/templates/${template.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'restore', version }),
      }),
    onSuccess: (data, version) => {
      void qc.invalidateQueries({ queryKey: ['templates'] })
      void qc.invalidateQueries({ queryKey: ['template-detail', template.id] })
      toast.success('Versão restaurada', {
        description: `Nova versão v${data.template.currentVersion} criada a partir da v${version} — histórico append-only preservado.`,
      })
      setRestoreTarget(null)
    },
    onError: (err) => {
      toast.error('Falha ao restaurar versão', { description: problemMessage(err) })
      setRestoreTarget(null)
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto custom-scroll sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-5 text-primary" /> Histórico — {template.name}
          </DialogTitle>
          <DialogDescription>
            Versões em ordem decrescente. Restaurar NÃO reescreve o histórico — cria uma versão
            nova com o corpo da versão escolhida.
          </DialogDescription>
        </DialogHeader>

        {detailQ.isLoading || !detail ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <ol className="relative max-h-[52vh] space-y-3 overflow-y-auto custom-scroll border-l-2 border-border pl-4">
            {detail.versions.map((v) => {
              const isCurrent = v.version === detail.currentVersion
              return (
                <li key={v.id} className="relative rounded-lg border bg-card p-3">
                  <span
                    aria-hidden
                    className={cn(
                      'absolute -left-[21px] top-4 size-2.5 rounded-full border-2 border-background',
                      isCurrent ? 'bg-primary' : 'bg-muted-foreground/50'
                    )}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-sm font-bold">v{v.version}</p>
                    {isCurrent ? (
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                        Atual
                      </Badge>
                    ) : (
                      <Badge variant="outline">Histórica</Badge>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {fmtDateTime(v.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Por <strong className="text-foreground">{v.authorName}</strong>
                  </p>
                  {v.changeNote && (
                    <p className="mt-1.5 text-sm leading-snug">{v.changeNote}</p>
                  )}
                  {!isCurrent && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => setRestoreTarget(v)}
                    >
                      <RefreshCw className="size-3.5" /> Restaurar esta versão
                    </Button>
                  )}
                </li>
              )
            })}
          </ol>
        )}

        <AlertDialog open={!!restoreTarget} onOpenChange={(open) => !open && setRestoreTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Restaurar a versão v{restoreTarget?.version}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Uma NOVA versão v{(template.currentVersion ?? 0) + 1} será criada com o corpo da
                v{restoreTarget?.version} (nota &ldquo;Restaurado da versão {restoreTarget?.version}
                &rdquo;). As versões existentes permanecem intactas no histórico.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={restore.isPending}
                onClick={() => restoreTarget && restore.mutate(restoreTarget.version)}
              >
                {restore.isPending && <RefreshCw className="animate-spin" />} Restaurar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}

// ─── Dialog preview (render no servidor) ────────────────────────────────────

/** Preview com placeholders resolvidos pelo SERVIDOR (sem contexto de vínculos). */
function TemplatePreviewDialog({ template, onClose }: { template: TemplateRow; onClose: () => void }) {
  const renderQ = useQuery({
    queryKey: ['template-render', template.id, template.currentVersion],
    queryFn: () =>
      apiFetch<RenderResponse>(`/api/v1/templates/${template.id}/render`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
  })
  const render = renderQ.data ?? null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto custom-scroll sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            <Eye className="size-5 text-primary" /> {template.name}
            <Badge variant="secondary" className="text-[11px]">
              {kindLabel(template.kind)}
            </Badge>
            <Badge variant="outline" className="font-mono text-[11px]">
              v{template.currentVersion}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Preview renderizado no servidor apenas com o contexto da Câmara (data, hora, local).
            Tokens de sessão/matéria só são resolvidos na criação de uma publicação vinculada.
          </DialogDescription>
        </DialogHeader>

        {renderQ.isLoading || !render ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : (
          <div className="space-y-4">
            {render.unresolved.length > 0 && (
              <div
                role="alert"
                className="rounded-lg border border-amber-300 bg-amber-500/10 p-3 text-sm dark:border-amber-800"
              >
                <p className="font-semibold text-amber-800 dark:text-amber-200">
                  {render.unresolved.length} placeholder(s) não resolvido(s) neste preview
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {render.unresolved.map((t) => (
                    <code
                      key={t}
                      className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-xs text-amber-900 dark:text-amber-100"
                    >
                      {`{{${t}}}`}
                    </code>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-amber-800/80 dark:text-amber-200/80">
                  Tokens de sessão/matéria exigem vínculo na publicação; desconhecidos permanecem
                  no texto para revisão.
                </p>
              </div>
            )}
            <section aria-label="Documento renderizado" className="rounded-lg border bg-muted/30 p-4">
              <MarkdownContent>{render.rendered}</MarkdownContent>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Módulo ─────────────────────────────────────────────────────────────────

export default function TemplatesModule() {
  const can = useApp((s) => s.can)
  const canWrite = can('template.write')
  const qc = useQueryClient()

  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput, 450)
  const [kindFilter, setKindFilter] = useState('all')
  const [formState, setFormState] = useState<FormDialogState | null>(null)
  const [historyTarget, setHistoryTarget] = useState<TemplateRow | null>(null)
  const [previewTarget, setPreviewTarget] = useState<TemplateRow | null>(null)
  const [toggleTarget, setToggleTarget] = useState<TemplateRow | null>(null)

  const templatesQ = useQuery({
    queryKey: ['templates'],
    queryFn: () => apiFetch<{ templates: TemplateRow[] }>('/api/v1/templates'),
  })
  const templates = templatesQ.data?.templates ?? []

  const q = search.trim().toLowerCase()
  const filtered = templates.filter(
    (t) =>
      (kindFilter === 'all' || t.kind === kindFilter) &&
      (!q || t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q))
  )

  const toggleActive = useMutation({
    mutationFn: (t: TemplateRow) =>
      apiFetch<{ template: TemplateRow }>(`/api/v1/templates/${t.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: t.active ? 'deactivate' : 'activate' }),
      }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['templates'] })
      toast.success(data.template.active ? 'Modelo reativado' : 'Modelo desativado', {
        description: data.template.active
          ? 'O modelo volta a aparecer na criação de publicações.'
          : 'Nada foi apagado — histórico preservado (append-only) e publicações já emitidas seguem válidas.',
      })
      setToggleTarget(null)
    },
    onError: (err) => {
      toast.error('Falha ao alternar o modelo', { description: problemMessage(err) })
      setToggleTarget(null)
    },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<FileStack />}
        title="Modelos de Documento"
        description="Templates versionados por tenant com placeholders e histórico append-only — padronizam atas, decretos, resoluções, portarias, editais e ofícios."
        actions={
          canWrite ? (
            <Button onClick={() => setFormState({ mode: 'create' })}>
              <Plus /> Novo modelo
            </Button>
          ) : undefined
        }
      />

      {/* Toolbar */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:flex-wrap">
        <div className="relative lg:w-64">
          <Search
            className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por nome ou descrição…"
            className="pl-8"
            aria-label="Buscar modelos por nome ou descrição"
          />
        </div>
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="lg:w-48" aria-label="Filtrar por tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {KIND_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground lg:ml-auto" aria-live="polite">
          {filtered.length} modelo(s)
        </p>
      </div>

      {/* Tabela */}
      {templatesQ.isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileStack />}
          title="Nenhum modelo encontrado"
          description={
            canWrite
              ? 'Crie o primeiro modelo de documento para padronizar as publicações da Casa.'
              : 'Ainda não há modelos de documento cadastrados nesta Casa Legislativa.'
          }
          action={
            canWrite ? (
              <Button onClick={() => setFormState({ mode: 'create' })}>
                <Plus /> Novo modelo
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="max-h-[62vh] overflow-auto custom-scroll rounded-xl border bg-card">
          <Table className="min-w-[56rem]">
            <caption className="sr-only">Modelos de documento do tenant</caption>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="w-36">Tipo</TableHead>
                <TableHead className="w-24">Versão</TableHead>
                <TableHead className="w-24">Situação</TableHead>
                <TableHead className="hidden w-56 md:table-cell">Última alteração</TableHead>
                <TableHead className="w-12 text-right">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t) => (
                <TableRow key={t.id} className={cn(!t.active && 'opacity-60')}>
                  <TableCell>
                    <p className="max-w-sm truncate font-medium" title={t.name}>
                      {t.name}
                    </p>
                    {t.description && (
                      <p
                        className="max-w-sm truncate text-xs text-muted-foreground"
                        title={t.description}
                      >
                        {t.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[11px]">
                      {kindLabel(t.kind)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs font-semibold">v{t.currentVersion}</span>
                  </TableCell>
                  <TableCell>
                    {t.active ? (
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                        Ativo
                      </Badge>
                    ) : (
                      <Badge variant="outline">Inativo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {t.lastVersion ? (
                      <div className="text-xs">
                        <p className="font-medium">{t.lastVersion.authorName}</p>
                        <p className="text-muted-foreground">{fmtDateTime(t.lastVersion.createdAt)}</p>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Ações do modelo ${t.name}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canWrite && (
                          <>
                            <DropdownMenuItem onClick={() => setFormState({ mode: 'edit', template: t })}>
                              <Pencil /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setFormState({ mode: 'edit', template: t })}>
                              <FilePlus2 /> Nova versão
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        <DropdownMenuItem onClick={() => setHistoryTarget(t)}>
                          <History /> Histórico
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setPreviewTarget(t)}>
                          <Eye /> Preview
                        </DropdownMenuItem>
                        {canWrite && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setToggleTarget(t)}
                            >
                              <Power /> {t.active ? 'Desativar' : 'Ativar'}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Dialogs */}
      {formState && <TemplateFormDialog state={formState} onClose={() => setFormState(null)} />}
      {historyTarget && (
        <TemplateHistoryDialog
          template={historyTarget}
          onClose={() => setHistoryTarget(null)}
        />
      )}
      {previewTarget && (
        <TemplatePreviewDialog template={previewTarget} onClose={() => setPreviewTarget(null)} />
      )}

      {/* Confirmação Desativar/Ativar */}
      <AlertDialog
        open={!!toggleTarget}
        onOpenChange={(open) => !open && setToggleTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggleTarget?.active ? 'Desativar' : 'Ativar'} o modelo &ldquo;{toggleTarget?.name}
              &rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toggleTarget?.active
                ? 'Modelos desativados deixam de aparecer na criação de publicações. Nada é apagado — o histórico append-only permanece e publicações já emitidas seguem válidas.'
                : 'O modelo volta a ficar disponível para novas publicações (tipos compatíveis).'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={toggleActive.isPending}
              onClick={() => toggleTarget && toggleActive.mutate(toggleTarget)}
            >
              {toggleActive.isPending && <RefreshCw className="animate-spin" />}
              {toggleTarget?.active ? 'Desativar' : 'Ativar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
