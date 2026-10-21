'use client'

/**
 * Módulo Matérias — consulta com filtros (busca com debounce, tipo, ano, status),
 * criação com autores em chips, expansão de linha e exportação CSV client-side.
 */
import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, Download, FilePlus2, FileText, PanelRightOpen, X } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDateTime, matterLabel } from '@/lib/format'
import {
  MATTER_STATUS_LABEL,
  MATTER_TYPE_LABEL,
  type MatterStatus,
  type MatterType,
  type MatterView,
} from '@/lib/contracts'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import MatterDrawer from '@/modules/workflow/matter-drawer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { exportCsv, useDebouncedValue } from '@/modules/_shared'

const MATTER_TYPES = Object.keys(MATTER_TYPE_LABEL) as MatterType[]
const MATTER_STATUSES = Object.keys(MATTER_STATUS_LABEL) as MatterStatus[]

function MatterStatusBadge({ status }: { status: MatterStatus }) {
  if (status === 'aprovado')
    return <Badge className="bg-emerald-700 text-white hover:bg-emerald-700">Aprovada</Badge>
  if (status === 'rejeitado') return <Badge className="bg-rose-600 text-white hover:bg-rose-600">Rejeitada</Badge>
  // Fase 17 — desfechos finais: sanção (verde-escuro) e veto (vermelho/rust).
  if (status === 'sancionado')
    return <Badge className="bg-emerald-800 text-white hover:bg-emerald-800">Sancionada</Badge>
  if (status === 'vetado')
    return <Badge className="bg-red-800 text-white hover:bg-red-800">Vetada</Badge>
  return <Badge variant="outline">{MATTER_STATUS_LABEL[status]}</Badge>
}

function NewMatterDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient()
  const [type, setType] = useState<MatterType>('projeto_de_lei')
  const [ementa, setEmenta] = useState('')
  const [authors, setAuthors] = useState<string[]>([])
  const [authorDraft, setAuthorDraft] = useState('')
  const [regime, setRegime] = useState<'ordinario' | 'urgencia'>('ordinario')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const mutation = useMutation({
    mutationFn: () =>
      api.createMatter({ type, ementa: ementa.trim(), authors, regime }),
    onSuccess: (res) => {
      toast.success('Matéria cadastrada', { description: matterLabel(res.matter.type, res.matter.number, res.matter.year) })
      queryClient.invalidateQueries({ queryKey: ['matters'] })
      setType('projeto_de_lei')
      setEmenta('')
      setAuthors([])
      setAuthorDraft('')
      setRegime('ordinario')
      setErrors({})
      onOpenChange(false)
    },
  })

  const addAuthor = () => {
    const name = authorDraft.trim()
    if (!name) return
    if (authors.some((a) => a.toLowerCase() === name.toLowerCase())) {
      setAuthorDraft('')
      return
    }
    setAuthors((prev) => [...prev, name])
    setAuthorDraft('')
  }

  const submit = () => {
    const errs: Record<string, string> = {}
    if (ementa.trim().length < 10) errs.ementa = 'Descreva a ementa (mín. 10 caracteres).'
    if (authors.length === 0) errs.authors = 'Informe ao menos um autor.'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto custom-scroll sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova matéria legislativa</DialogTitle>
          <DialogDescription>
            A numeração é gerada automaticamente por tipo e ano. O regime de urgência altera a ordem de tramitação.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="matter-type">Tipo *</Label>
            <Select value={type} onValueChange={(v) => setType(v as MatterType)}>
              <SelectTrigger id="matter-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MATTER_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {MATTER_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="matter-ementa">Ementa *</Label>
            <Textarea
              id="matter-ementa"
              value={ementa}
              onChange={(e) => setEmenta(e.target.value)}
              placeholder="Objeto da matéria em uma frase clara."
              rows={3}
              aria-invalid={!!errors.ementa}
            />
            {errors.ementa && <p className="text-xs text-destructive">{errors.ementa}</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="matter-author">Autores *</Label>
            <Input
              id="matter-author"
              value={authorDraft}
              onChange={(e) => setAuthorDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addAuthor()
                }
              }}
              placeholder="Digite o nome e pressione Enter"
              aria-invalid={!!errors.authors}
            />
            {errors.authors && <p className="text-xs text-destructive">{errors.authors}</p>}
            {authors.length > 0 && (
              <ul className="flex flex-wrap gap-1.5 pt-1" aria-label="Autores adicionados">
                {authors.map((a) => (
                  <li key={a}>
                    <Badge variant="secondary" className="gap-1 pr-1 font-normal">
                      {a}
                      <button
                        type="button"
                        onClick={() => setAuthors((prev) => prev.filter((x) => x !== a))}
                        className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                        aria-label={`Remover autor ${a}`}
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Pressione <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">Enter</kbd> para adicionar cada autor.
            </p>
          </div>

          <div className="grid gap-2">
            <Label>Regime de tramitação</Label>
            <RadioGroup value={regime} onValueChange={(v) => setRegime(v as 'ordinario' | 'urgencia')} className="flex gap-6">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="ordinario" id="regime-ordinario" />
                <Label htmlFor="regime-ordinario" className="font-normal">
                  Ordinário
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="urgencia" id="regime-urgencia" />
                <Label htmlFor="regime-urgencia" className="font-normal">
                  Urgência
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Cadastrando…' : 'Cadastrar matéria'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function MattersModule() {
  const can = useApp((s) => s.can)
  const canWrite = can('matter.write')

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 400)
  const [typeFilter, setTypeFilter] = useState('todos')
  const [yearFilter, setYearFilter] = useState('todos')
  const [statusFilter, setStatusFilter] = useState('todos')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [detail, setDetail] = useState<MatterView | null>(null)

  const filters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      type: typeFilter !== 'todos' ? typeFilter : undefined,
      year: yearFilter !== 'todos' ? yearFilter : undefined,
      status: statusFilter !== 'todos' ? statusFilter : undefined,
    }),
    [debouncedSearch, typeFilter, yearFilter, statusFilter]
  )

  const { data, isLoading } = useQuery({
    queryKey: ['matters', filters],
    queryFn: () => api.listMatters(filters),
  })

  const matters = data?.matters ?? []
  const years = useMemo(() => [...new Set(matters.map((m) => m.year))].sort((a, b) => b - a), [matters])

  const exportCsvFile = () => {
    if (matters.length === 0) {
      toast.info('Nada a exportar', { description: 'Nenhuma matéria no filtro atual.' })
      return
    }
    exportCsv(
      `materias-legis-${new Date().toISOString().slice(0, 10)}.csv`,
      matters.map((m) => ({
        Matéria: matterLabel(m.type, m.number, m.year),
        Tipo: MATTER_TYPE_LABEL[m.type] ?? m.type,
        Ementa: m.ementa,
        Autores: m.authors.join('; '),
        Status: MATTER_STATUS_LABEL[m.status] ?? m.status,
        Regime: m.regime === 'urgencia' ? 'Urgência' : 'Ordinário',
        'Criada em': fmtDateTime(m.createdAt),
      }))
    )
    toast.success('CSV exportado', { description: `${matters.length} matéria(s) no filtro atual.` })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Matérias"
        description="Projetos, requerimentos, indicações e demais peças legislativas do tenant."
        icon={<FileText />}
        actions={
          <>
            <Button variant="outline" onClick={exportCsvFile}>
              <Download /> Exportar CSV
            </Button>
            {canWrite && (
              <Button onClick={() => setDialogOpen(true)}>
                <FilePlus2 /> Nova matéria
              </Button>
            )}
          </>
        }
      />

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3" role="search" aria-label="Filtros de matérias">
        <div className="grid flex-1 gap-1.5 sm:max-w-xs">
          <Label htmlFor="matter-search" className="text-xs text-muted-foreground">
            Busca (ementa / autores)
          </Label>
          <Input
            id="matter-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ex.: praças, saúde…"
            className="h-9"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="matter-type-filter" className="text-xs text-muted-foreground">
            Tipo
          </Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger id="matter-type-filter" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {MATTER_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {MATTER_TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="matter-year-filter" className="text-xs text-muted-foreground">
            Ano
          </Label>
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger id="matter-year-filter" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="matter-status-filter" className="text-xs text-muted-foreground">
            Status
          </Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger id="matter-status-filter" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {MATTER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {MATTER_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabela */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : matters.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title="Nenhuma matéria encontrada"
          description="Ajuste a busca ou os filtros, ou cadastre uma nova matéria legislativa."
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <TooltipProvider delayDuration={200}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" aria-label="Expandir" />
                  <TableHead scope="col">Matéria</TableHead>
                  <TableHead scope="col">Tipo</TableHead>
                  <TableHead scope="col">Autores</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Regime</TableHead>
                  <TableHead scope="col" className="max-w-[24rem]">Ementa</TableHead>
                  <TableHead scope="col">
                    <span className="sr-only">Detalhes e tramitação</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matters.map((m) => {
                  const expanded = expandedId === m.id
                  return (
                    <Fragment key={m.id}>
                      <TableRow
                        onClick={() => setExpandedId(expanded ? null : m.id)}
                        aria-expanded={expanded}
                        className="cursor-pointer"
                      >
                        <TableCell className="text-muted-foreground">
                          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </TableCell>
                        <TableCell className="font-mono text-sm font-bold">{matterLabel(m.type, m.number, m.year)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{MATTER_TYPE_LABEL[m.type] ?? m.type}</TableCell>
                        <TableCell className="text-sm">
                          {m.authors[0] ?? '—'}
                          {m.authors.length > 1 && (
                            <span className="ml-1 text-xs text-muted-foreground">+{m.authors.length - 1}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <MatterStatusBadge status={m.status} />
                        </TableCell>
                        <TableCell>
                          {m.regime === 'urgencia' ? (
                            <Badge className="bg-amber-700 text-white hover:bg-amber-700">Urgência</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Ordinário</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[24rem] whitespace-normal">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="line-clamp-1 text-sm text-muted-foreground">{m.ementa}</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-sm text-xs">
                              {m.ementa}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={`Abrir detalhes e tramitação de ${matterLabel(m.type, m.number, m.year)}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setDetail(m)
                            }}
                          >
                            <PanelRightOpen className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableCell />
                          <TableCell colSpan={6} className="whitespace-normal">
                            <div className="grid gap-2 py-1">
                              <p className="text-sm">{m.ementa}</p>
                              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                                <span>
                                  <strong className="text-foreground">Autores:</strong> {m.authors.join(', ') || '—'}
                                </span>
                                <span>
                                  <strong className="text-foreground">Criada em:</strong> {fmtDateTime(m.createdAt)}
                                </span>
                                <span>
                                  <strong className="text-foreground">Tipo:</strong> {MATTER_TYPE_LABEL[m.type] ?? m.type}
                                </span>
                              </div>
                              <div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => setDetail(m)}
                                >
                                  <PanelRightOpen className="size-3.5" /> Detalhes, tramitação, versões e anexos
                                </Button>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </TooltipProvider>
        </div>
      )}

      <NewMatterDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      {/* Drawer de detalhe com tramitação, versões e anexos (compartilhado com o módulo Workflow) */}
      <MatterDrawer matter={detail} onOpenChange={() => setDetail(null)} />
    </div>
  )
}
