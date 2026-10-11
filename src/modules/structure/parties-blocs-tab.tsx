'use client'

/**
 * Tab Partidos e Blocos — dois cards lado a lado: partidos (sigla, nome, número,
 * ativo) CRUD e blocos (nome, partidos) CRUD. Soft delete via active.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, CircleOff, Flag, Landmark, Link2, Pencil, Plus, ShieldOff } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import type { BlocView, PartyView } from '@/lib/contracts'
import { EmptyState } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default function PartiesBlocsTab() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <PartiesCard />
      <BlocsCard />
    </div>
  )
}

// ─── Partidos ───────────────────────────────────────────────────────────────

function PartiesCard() {
  const can = useApp((s) => s.can)
  const canWrite = can('structure.write')
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<PartyView | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['parties'], queryFn: () => api.listParties() })
  const parties = data?.parties ?? []

  const toggleActive = useMutation({
    mutationFn: (p: PartyView) => api.updateParty(p.id, { active: !p.active }),
    onSuccess: (res) => {
      toast.success(res.party.active ? 'Partido reativado' : 'Partido desativado', {
        description: res.party.acronym,
      })
      queryClient.invalidateQueries({ queryKey: ['parties'] })
    },
  })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Flag className="size-4 text-primary" /> Partidos
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {parties.filter((p) => p.active).length} ativos
          </span>
        </CardTitle>
        {canWrite && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
          >
            <Plus /> Novo
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : parties.length === 0 ? (
          <EmptyState
            icon={<Flag />}
            title="Nenhum partido cadastrado"
            description="Cadastre os partidos do tenant para vincular às bancadas."
          />
        ) : (
          <div className="max-h-96 overflow-y-auto custom-scroll rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Sigla</TableHead>
                  <TableHead scope="col">Nome</TableHead>
                  <TableHead scope="col">Nº</TableHead>
                  <TableHead scope="col">Situação</TableHead>
                  {canWrite && <TableHead scope="col" className="text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {parties.map((p) => (
                  <TableRow key={p.id} className={p.active ? undefined : 'opacity-70'}>
                    <TableCell className="font-mono text-sm font-bold"><span className="flex items-center gap-2">{p.emblemUrl && <img src={p.emblemUrl} alt="" className="size-7 object-contain" />}{p.acronym}</span></TableCell>
                    <TableCell className="max-w-[12rem] truncate text-sm text-muted-foreground" title={p.name}>
                      {p.name}
                    </TableCell>
                    <TableCell className="tabular-nums text-sm text-muted-foreground">
                      {p.number ?? '—'}
                    </TableCell>
                    <TableCell>
                      {p.active ? (
                        <Badge variant="outline" className="gap-1 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="size-3" /> Ativo
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <CircleOff className="size-3" /> Inativo
                        </Badge>
                      )}
                    </TableCell>
                    {canWrite && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Editar partido ${p.acronym}`}
                            onClick={() => {
                              setEditing(p)
                              setDialogOpen(true)
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={p.active ? `Desativar partido ${p.acronym}` : `Reativar partido ${p.acronym}`}
                            onClick={() => toggleActive.mutate(p)}
                            disabled={toggleActive.isPending}
                          >
                            <ShieldOff className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <PartyDialog key={editing?.id ?? 'new'} open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
    </Card>
  )
}

function PartyDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: PartyView | null
}) {
  const queryClient = useQueryClient()
  const [acronym, setAcronym] = useState(editing?.acronym ?? '')
  const [name, setName] = useState(editing?.name ?? '')
  const [number, setNumber] = useState(editing?.number !== null && editing?.number !== undefined ? String(editing.number) : '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [emblemUrl, setEmblemUrl] = useState<string | null>(editing?.emblemUrl ?? null)
  const [emblemFile, setEmblemFile] = useState<File | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const numberVal = number.trim() === '' ? null : Number(number)
      const uploaded = emblemFile ? await api.uploadParliamentarianImage('partyEmblem', emblemFile) : null
      return editing
        ? api.updateParty(editing.id, { name: name.trim(), number: numberVal, emblemUrl: uploaded?.url ?? emblemUrl })
        : api.createParty({ acronym: acronym.trim().toUpperCase(), name: name.trim(), number: numberVal })
    },
    onSuccess: () => {
      toast.success(editing ? 'Partido atualizado' : 'Partido cadastrado', {
        description: editing?.acronym ?? acronym.toUpperCase(),
      })
      queryClient.invalidateQueries({ queryKey: ['parties'] })
      onOpenChange(false)
    },
  })

  const submit = () => {
    const errs: Record<string, string> = {}
    if (!editing && acronym.trim().length < 2) errs.acronym = 'Sigla com 2–10 caracteres.'
    if (name.trim().length < 4) errs.name = 'Informe o nome do partido.'
    if (number.trim() !== '' && !/^\d{1,3}$/.test(number.trim())) errs.number = 'Número eleitoral inválido.'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Editar ${editing.acronym}` : 'Novo partido'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'A sigla não é alterável (chave do tenant). Desativar é feito na listagem.'
              : 'Cadastre o partido com sigla, nome e número eleitoral.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="party-acronym">Sigla *</Label>
            <Input
              id="party-acronym"
              value={editing ? editing.acronym : acronym}
              disabled={!!editing}
              onChange={(e) => setAcronym(e.target.value.toUpperCase())}
              maxLength={10}
              placeholder="PT"
              aria-invalid={!!errors.acronym}
            />
            {errors.acronym && <p className="text-xs text-destructive">{errors.acronym}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="party-number">Nº eleitoral</Label>
            <Input
              id="party-number"
              inputMode="numeric"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="13"
              maxLength={3}
              aria-invalid={!!errors.number}
            />
            {errors.number && <p className="text-xs text-destructive">{errors.number}</p>}
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="party-name">Nome *</Label>
            <Input
              id="party-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Partido dos Trabalhadores"
              aria-invalid={!!errors.name}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>
          {editing && <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="party-emblem">Emblema do partido</Label>
            {emblemUrl && !emblemFile && <img src={emblemUrl} alt={`Emblema ${editing.acronym}`} className="size-16 object-contain" />}
            <Input id="party-emblem" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setEmblemFile(event.target.files?.[0] ?? null)} />
            {(emblemUrl || emblemFile) && <Button type="button" variant="outline" size="sm" onClick={() => { setEmblemUrl(null); setEmblemFile(null) }}>Remover emblema</Button>}
          </div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Salvando…' : editing ? 'Salvar' : 'Cadastrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Blocos ─────────────────────────────────────────────────────────────────

function BlocsCard() {
  const can = useApp((s) => s.can)
  const canWrite = can('structure.write')
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<BlocView | null>(null)

  const partiesQ = useQuery({ queryKey: ['parties'], queryFn: () => api.listParties() })
  const parties = partiesQ.data?.parties ?? []

  const { data, isLoading } = useQuery({ queryKey: ['blocs'], queryFn: () => api.listBlocs() })
  const blocs = data?.blocs ?? []

  const toggleActive = useMutation({
    mutationFn: (b: BlocView) => api.updateBloc(b.id, { active: !b.active }),
    onSuccess: (res) => {
      toast.success(res.bloc.active ? 'Bloco reativado' : 'Bloco desativado', { description: res.bloc.name })
      queryClient.invalidateQueries({ queryKey: ['blocs'] })
    },
  })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4 text-primary" /> Blocos parlamentares
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {blocs.filter((b) => b.active).length} ativos
          </span>
        </CardTitle>
        {canWrite && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
          >
            <Plus /> Novo
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : blocs.length === 0 ? (
          <EmptyState
            icon={<Landmark />}
            title="Nenhum bloco cadastrado"
            description="Blocos reúnem partidos para composição de bancadas."
          />
        ) : (
          <ul className="max-h-96 space-y-2 overflow-y-auto custom-scroll pr-1">
            {blocs.map((b) => (
              <li key={b.id} className={`rounded-lg border p-3 ${b.active ? '' : 'opacity-70'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{b.name}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {b.partyAcronyms.length > 0 ? (
                        b.partyAcronyms.map((a) => (
                          <Badge key={a} variant="outline" className="font-mono text-[11px]">
                            {a}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem partidos vinculados</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {b.active ? (
                      <Badge variant="outline" className="gap-1 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="size-3" /> Ativo
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-muted-foreground">
                        <CircleOff className="size-3" /> Inativo
                      </Badge>
                    )}
                    {canWrite && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Editar bloco ${b.name}`}
                          onClick={() => {
                            setEditing(b)
                            setDialogOpen(true)
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={b.active ? `Desativar bloco ${b.name}` : `Reativar bloco ${b.name}`}
                          onClick={() => toggleActive.mutate(b)}
                          disabled={toggleActive.isPending}
                        >
                          <ShieldOff className="size-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <BlocDialog key={editing?.id ?? 'new'} open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} parties={parties} />
    </Card>
  )
}

function BlocDialog({
  open,
  onOpenChange,
  editing,
  parties,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: BlocView | null
  parties: PartyView[]
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(editing?.name ?? '')
  const [selected, setSelected] = useState<string[]>(editing?.partyAcronyms ?? [])
  const [errors, setErrors] = useState<Record<string, string>>({})

  const mutation = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), partyAcronyms: selected }
      return editing ? api.updateBloc(editing.id, payload) : api.createBloc(payload)
    },
    onSuccess: () => {
      toast.success(editing ? 'Bloco atualizado' : 'Bloco criado', { description: name.trim() })
      queryClient.invalidateQueries({ queryKey: ['blocs'] })
      onOpenChange(false)
    },
  })

  const toggle = (acronym: string) => {
    setSelected((prev) =>
      prev.includes(acronym) ? prev.filter((a) => a !== acronym) : [...prev, acronym]
    )
  }

  const submit = () => {
    const errs: Record<string, string> = {}
    if (name.trim().length < 3) errs.name = 'Informe o nome do bloco (mín. 3 caracteres).'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Editar ${editing.name}` : 'Novo bloco parlamentar'}</DialogTitle>
          <DialogDescription>
            Selecione os partidos que compõem o bloco. Parlamentares dessas legendas passam a integrar a bancada.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="bloc-name">Nome *</Label>
            <Input
              id="bloc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Bloco Situação"
              aria-invalid={!!errors.name}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Partidos ({selected.length} selecionados)</legend>
            {parties.length === 0 ? (
              <p className="text-xs text-muted-foreground">Cadastre partidos antes de montar o bloco.</p>
            ) : (
              <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto custom-scroll rounded-lg border p-3">
                {parties.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.acronym)}
                    aria-pressed={selected.includes(p.acronym)}
                    className={`rounded-md border px-2 py-1 font-mono text-xs transition ${
                      selected.includes(p.acronym)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-background text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {p.acronym}
                  </button>
                ))}
              </div>
            )}
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Salvando…' : editing ? 'Salvar' : 'Criar bloco'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
