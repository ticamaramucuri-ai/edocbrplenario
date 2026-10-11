'use client'

/**
 * Tab Mesa Diretora — composição vigente (grid de cards por cargo), histórico
 * com vigência e ações: designar, encerrar vigência (confirmação) e transferir
 * cargo (dialog com select de parlamentar).
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRightLeft, CalendarCheck2, Gavel, History, UserRoundCheck, UserRoundMinus } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { initials, fmtDateShort } from '@/lib/format'
import { BOARD_ROLE_LABEL, type BoardPositionView, type ParliamentarianView } from '@/lib/contracts'
import { EmptyState } from '@/components/app/page-header'
import { PartyBadge } from '@/components/app/badges'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const BOARD_ROLES = ['presidente', 'vice_presidente', 'primeiro_secretario', 'segundo_secretario'] as const

export default function BoardTab() {
  const can = useApp((s) => s.can)
  const canWrite = can('structure.write')
  const queryClient = useQueryClient()

  const [designateOpen, setDesignateOpen] = useState(false)
  const [transferring, setTransferring] = useState<BoardPositionView | null>(null)
  const [ending, setEnding] = useState<BoardPositionView | null>(null)

  const boardQ = useQuery({ queryKey: ['board'], queryFn: () => api.listBoard() })
  const parlQ = useQuery({ queryKey: ['parliamentarians'], queryFn: () => api.listParliamentarians() })
  const legQ = useQuery({ queryKey: ['legislatures'], queryFn: () => api.listLegislatures() })

  const positions = boardQ.data?.board ?? []
  const current = positions.filter((p) => p.current)
  const history = positions.filter((p) => !p.current)
  const activeParliamentarians = (parlQ.data?.parliamentarians ?? []).filter((p) => p.active)
  const legislatures = legQ.data?.legislatures ?? []
  const currentLegislature = legislatures.find((l) => l.current) ?? legislatures[0] ?? null

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['board'] })
  }

  const endMutation = useMutation({
    mutationFn: (id: string) => api.patchBoardPosition(id, { action: 'encerrar' }),
    onSuccess: (res) => {
      toast.success('Vigência encerrada', {
        description: `${BOARD_ROLE_LABEL[res.position.role]} — ${res.position.parliamentarianName}`,
      })
      invalidate()
      setEnding(null)
    },
  })

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Gavel className="size-4" /> Composição vigente
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {currentLegislature
                  ? `${currentLegislature.number}ª Legislatura (${currentLegislature.startYear}–${currentLegislature.endYear})`
                  : 'Cadastre uma legislatura para designar a Mesa.'}
              </p>
            </div>
            {canWrite && (
              <Button onClick={() => setDesignateOpen(true)} disabled={!currentLegislature}>
                <UserRoundCheck /> Designar cargo
              </Button>
            )}
          </div>

          {boardQ.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-36 rounded-xl" />
              ))}
            </div>
          ) : current.length === 0 ? (
            <EmptyState
              icon={<Gavel />}
              title="Nenhum cargo em vigência"
              description="Designe os ocupantes dos cargos da Mesa Diretora para a legislatura atual."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {BOARD_ROLES.map((role) => {
                const pos = current.find((p) => p.role === role)
                return (
                  <Card key={role} className={pos ? undefined : 'border-dashed'}>
                    <CardContent className="flex h-full flex-col gap-3 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {BOARD_ROLE_LABEL[role]}
                      </p>
                      {pos ? (
                        <>
                          <div className="flex items-center gap-3">
                            <Avatar className="size-11">
                              <AvatarFallback className="bg-primary/15 text-sm font-bold text-primary">
                                {initials(pos.parliamentarianName)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold leading-tight">{pos.parliamentarianName}</p>
                              <PartyBadge party={pos.parliamentarianParty} />
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            <CalendarCheck2 className="mr-1 inline size-3" aria-hidden />
                            Desde {fmtDateShort(pos.startDate)}
                          </p>
                          {canWrite && (
                            <div className="mt-auto flex gap-1.5 pt-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 flex-1"
                                onClick={() => setTransferring(pos)}
                              >
                                <ArrowRightLeft className="size-3.5" /> Transferir
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8"
                                aria-label={`Encerrar vigência de ${pos.parliamentarianName}`}
                                onClick={() => setEnding(pos)}
                              >
                                <UserRoundMinus className="size-3.5" />
                              </Button>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="flex flex-1 items-center text-sm text-muted-foreground">
                          {canWrite ? 'Vago — use “Designar cargo”.' : 'Cargo vago.'}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4 sm:p-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <History className="size-4" /> Histórico da Mesa
          </h3>
          {boardQ.isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sem vigências encerradas — o histórico aparece aqui conforme transferências e encerramentos.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto custom-scroll rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Cargo</TableHead>
                    <TableHead scope="col">Parlamentar</TableHead>
                    <TableHead scope="col">Legislatura</TableHead>
                    <TableHead scope="col">Vigência</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">{BOARD_ROLE_LABEL[p.role] ?? p.role}</TableCell>
                      <TableCell className="text-sm font-medium">{p.parliamentarianName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.legislatureNumber}ª</TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {fmtDateShort(p.startDate)} → {fmtDateShort(p.endDate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Designar cargo */}
      <DesignateDialog
        open={designateOpen}
        onOpenChange={setDesignateOpen}
        parliamentarians={activeParliamentarians}
        legislatures={legislatures}
        defaultLegislatureId={currentLegislature?.id ?? null}
        occupiedRoles={current.map((p) => p.role)}
      />

      {/* Transferir cargo */}
      <TransferDialog
        position={transferring}
        onOpenChange={(v) => !v && setTransferring(null)}
        parliamentarians={activeParliamentarians}
      />

      {/* Encerrar vigência */}
      <AlertDialog open={!!ending} onOpenChange={(v) => !v && setEnding(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar vigência do cargo?</AlertDialogTitle>
            <AlertDialogDescription>
              {ending && (
                <>
                  <strong>{BOARD_ROLE_LABEL[ending.role]}</strong> — {ending.parliamentarianName} deixará o cargo com
                  vigência encerrada em agora. O registro histórico é preservado e o cargo fica vago.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter vigência</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => ending && endMutation.mutate(ending.id)}
              disabled={endMutation.isPending}
            >
              Encerrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DesignateDialog({
  open,
  onOpenChange,
  parliamentarians,
  legislatures,
  defaultLegislatureId,
  occupiedRoles,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  parliamentarians: ParliamentarianView[]
  legislatures: Array<{ id: string; number: number }>
  defaultLegislatureId: string | null
  occupiedRoles: string[]
}) {
  const queryClient = useQueryClient()
  const [legislatureId, setLegislatureId] = useState(defaultLegislatureId ?? '')
  const [role, setRole] = useState<string>('presidente')
  const [parliamentarianId, setParliamentarianId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const mutation = useMutation({
    mutationFn: () =>
      api.createBoardPosition({ legislatureId, role, parliamentarianId }),
    onSuccess: (res) => {
      toast.success('Cargo designado', {
        description: `${BOARD_ROLE_LABEL[res.position.role]}: ${res.position.parliamentarianName}`,
      })
      queryClient.invalidateQueries({ queryKey: ['board'] })
      setRole('presidente')
      setParliamentarianId('')
      setErrors({})
      onOpenChange(false)
    },
  })

  const submit = () => {
    const errs: Record<string, string> = {}
    if (!legislatureId) errs.legislatureId = 'Selecione a legislatura.'
    if (!parliamentarianId) errs.parliamentarianId = 'Selecione o parlamentar.'
    if (occupiedRoles.includes(role)) errs.role = 'Cargo já possui vigência aberta — encerre ou transfira antes.'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    mutation.mutate()
  }

  const availableRoles = BOARD_ROLES.filter((r) => !occupiedRoles.includes(r))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Designar cargo da Mesa</DialogTitle>
          <DialogDescription>
            A designação registra a vigência a partir de hoje (ou da data informada). Cargos já ocupados não aparecem.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="board-legislature">Legislatura *</Label>
            <Select value={legislatureId} onValueChange={setLegislatureId}>
              <SelectTrigger id="board-legislature" className="w-full">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {legislatures.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.number}ª Legislatura
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.legislatureId && <p className="text-xs text-destructive">{errors.legislatureId}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="board-role">Cargo *</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="board-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableRoles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {BOARD_ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.role && <p className="text-xs text-destructive">{errors.role}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="board-parl">Parlamentar *</Label>
            <Select value={parliamentarianId} onValueChange={setParliamentarianId}>
              <SelectTrigger id="board-parl" className="w-full">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {parliamentarians.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.party})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.parliamentarianId && <p className="text-xs text-destructive">{errors.parliamentarianId}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Designando…' : 'Designar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TransferDialog({
  position,
  onOpenChange,
  parliamentarians,
}: {
  position: BoardPositionView | null
  onOpenChange: (v: boolean) => void
  parliamentarians: ParliamentarianView[]
}) {
  const queryClient = useQueryClient()
  const [parliamentarianId, setParliamentarianId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (id: string) =>
      api.patchBoardPosition(position!.id, { action: 'transferir', parliamentarianId: id }),
    onSuccess: (res) => {
      toast.success('Cargo transferido', {
        description: res.successor
          ? `${BOARD_ROLE_LABEL[res.successor.role]}: ${res.successor.parliamentarianName}`
          : undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['board'] })
      setParliamentarianId('')
      setError(null)
      onOpenChange(false)
    },
  })

  const submit = () => {
    if (!parliamentarianId) {
      setError('Selecione o novo ocupante do cargo.')
      return
    }
    setError(null)
    mutation.mutate(parliamentarianId)
  }

  return (
    <Dialog open={!!position} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Transferir {position ? BOARD_ROLE_LABEL[position.role] : 'cargo'}
          </DialogTitle>
          <DialogDescription>
            {position && (
              <>
                Vigência de <strong>{position.parliamentarianName}</strong> é encerrada agora e o parlamentar
                selecionado assume com nova vigência — histórico preservado.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="transfer-parl">Novo ocupante *</Label>
          <Select value={parliamentarianId} onValueChange={setParliamentarianId}>
            <SelectTrigger id="transfer-parl" className="w-full">
              <SelectValue placeholder="Selecione o parlamentar" />
            </SelectTrigger>
            <SelectContent>
              {parliamentarians
                .filter((p) => p.id !== position?.parliamentarianId)
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.party})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Transferindo…' : 'Transferir cargo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
