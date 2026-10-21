'use client'

/**
 * Tab Legislaturas — tabela (número, período, atual), criar/editar dialog,
 * marcar como atual com confirmação reforçada. Legislaturas nunca são excluídas.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarRange, CheckCircle2, Landmark, Pencil, Plus } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import type { LegislatureView } from '@/lib/contracts'
import { EmptyState } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default function LegislaturesTab() {
  const can = useApp((s) => s.can)
  const canWrite = can('structure.write')
  const queryClient = useQueryClient()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<LegislatureView | null>(null)
  const [markingCurrent, setMarkingCurrent] = useState<LegislatureView | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['legislatures'], queryFn: () => api.listLegislatures() })
  const legislatures = data?.legislatures ?? []

  const setCurrent = useMutation({
    mutationFn: (id: string) => api.updateLegislature(id, { current: true }),
    onSuccess: () => {
      toast.success('Legislatura marcada como atual', {
        description: 'As demais legislaturas do tenant foram desmarcadas.',
      })
      queryClient.invalidateQueries({ queryKey: ['legislatures'] })
      setMarkingCurrent(null)
    },
  })

  const period = (l: LegislatureView) => `${l.startYear} – ${l.endYear}`

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            A legislatura atual direciona os defaults de mandato, comissão e Mesa Diretora.
          </p>
          {canWrite && (
            <Button
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
            >
              <Plus /> Nova legislatura
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : legislatures.length === 0 ? (
          <EmptyState
            icon={<Landmark />}
            title="Nenhuma legislatura cadastrada"
            description="Cadastre a primeira legislatura para habilitar mandatos, Mesa Diretora e comissões."
          />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Legislatura</TableHead>
                  <TableHead scope="col">Período</TableHead>
                  <TableHead scope="col">Situação</TableHead>
                  <TableHead scope="col" className="text-right">
                    Ações
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {legislatures.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-semibold">{`${l.number}ª Legislatura`}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{period(l)}</TableCell>
                    <TableCell>
                      {l.current ? (
                        <Badge className="gap-1 bg-emerald-700 text-white hover:bg-emerald-700">
                          <CheckCircle2 className="size-3" /> Atual
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <CalendarRange className="size-3" /> Histórica
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canWrite && !l.current && (
                          <Button variant="outline" size="sm" onClick={() => setMarkingCurrent(l)}>
                            Marcar como atual
                          </Button>
                        )}
                        {canWrite && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Editar legislatura ${l.number}`}
                            onClick={() => {
                              setEditing(l)
                              setDialogOpen(true)
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <LegislatureDialog
        key={editing?.id ?? 'new'}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />

      <AlertDialog open={!!markingCurrent} onOpenChange={(v) => !v && setMarkingCurrent(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Marcar {markingCurrent?.number}ª Legislatura como atual?</AlertDialogTitle>
            <AlertDialogDescription>
              As demais legislaturas serão desmarcadas automaticamente. A alteração é auditada e reflete nos
              cadastros de mandatos, comissões e Mesa Diretora.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => markingCurrent && setCurrent.mutate(markingCurrent.id)}
              disabled={setCurrent.isPending}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function LegislatureDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: LegislatureView | null
}) {
  const queryClient = useQueryClient()
  const [number, setNumber] = useState(String(editing?.number ?? ''))
  const [startYear, setStartYear] = useState(String(editing?.startYear ?? new Date().getFullYear()))
  const [endYear, setEndYear] = useState(String(editing?.endYear ?? new Date().getFullYear() + 3))
  const [errors, setErrors] = useState<Record<string, string>>({})

  const mutation = useMutation({
    mutationFn: () => {
      const payload = { number: Number(number), startYear: Number(startYear), endYear: Number(endYear) }
      return editing ? api.updateLegislature(editing.id, payload) : api.createLegislature({ ...payload, current: false })
    },
    onSuccess: () => {
      toast.success(editing ? 'Legislatura atualizada' : 'Legislatura cadastrada')
      queryClient.invalidateQueries({ queryKey: ['legislatures'] })
      onOpenChange(false)
    },
  })

  const submit = () => {
    const errs: Record<string, string> = {}
    if (!Number.isInteger(Number(number)) || Number(number) < 1) errs.number = 'Informe um número válido.'
    if (!/^\d{4}$/.test(startYear)) errs.startYear = 'Ano inicial inválido (4 dígitos).'
    if (!/^\d{4}$/.test(endYear)) errs.endYear = 'Ano final inválido (4 dígitos).'
    if (Number(endYear) < Number(startYear)) errs.endYear = 'Ano final menor que o inicial.'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Editar ${editing.number}ª Legislatura` : 'Nova legislatura'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Ajuste o número ou o período. Marcá-la como atual é feito na listagem, com confirmação.'
              : 'Cadastre o período da legislatura (ex.: 2025–2028). A numeração segue a ordem histórica.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="leg-number">Número</Label>
            <Input
              id="leg-number"
              type="number"
              min={1}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              aria-invalid={!!errors.number}
            />
            {errors.number && <p className="text-xs text-destructive">{errors.number}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="leg-start">Ano inicial</Label>
            <Input
              id="leg-start"
              inputMode="numeric"
              maxLength={4}
              value={startYear}
              onChange={(e) => setStartYear(e.target.value)}
              aria-invalid={!!errors.startYear}
            />
            {errors.startYear && <p className="text-xs text-destructive">{errors.startYear}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="leg-end">Ano final</Label>
            <Input
              id="leg-end"
              inputMode="numeric"
              maxLength={4}
              value={endYear}
              onChange={(e) => setEndYear(e.target.value)}
              aria-invalid={!!errors.endYear}
            />
            {errors.endYear && <p className="text-xs text-destructive">{errors.endYear}</p>}
          </div>
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
