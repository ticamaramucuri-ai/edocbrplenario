'use client'

/**
 * Tab Protocolo — livro de protocolo: tabela (nº/ano, espécie, remetente,
 * assunto, status badge, matéria vinculada), criar entrada, distribuir/arquivar/
 * anular (justificativa obrigatória), filtros por ano/status.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Archive,
  BookOpenCheck,
  CheckCircle2,
  CircleSlash,
  Inbox,
  Send,
  XCircle,
} from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDateTime } from '@/lib/format'
import {
  PROTOCOL_KIND_LABEL,
  PROTOCOL_STATUS_LABEL,
  type ProtocolEntryView,
} from '@/lib/contracts'
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
import { Textarea } from '@/components/ui/textarea'

export default function ProtocolTab() {
  const can = useApp((s) => s.can)
  const canWrite = can('protocol.write')
  const queryClient = useQueryClient()

  const [yearFilter, setYearFilter] = useState('todos')
  const [statusFilter, setStatusFilter] = useState('todos')
  const [createOpen, setCreateOpen] = useState(false)
  const [distributing, setDistributing] = useState<ProtocolEntryView | null>(null)
  const [archiving, setArchiving] = useState<ProtocolEntryView | null>(null)
  const [annulling, setAnnulling] = useState<ProtocolEntryView | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['protocols', yearFilter, statusFilter],
    queryFn: () =>
      api.listProtocols({
        year: yearFilter !== 'todos' ? yearFilter : undefined,
        status: statusFilter !== 'todos' ? statusFilter : undefined,
      }),
  })

  const protocols = data?.protocols ?? []
  const counts = data?.counts ?? {}
  const years = useMemo(
    () => [...new Set(protocols.map((p) => p.year))].sort((a, b) => b - a),
    [protocols]
  )

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['protocols'] })

  return (
    <div className="space-y-4">
      {/* Resumo por status */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['recebido', 'distribuido', 'arquivado', 'anulado'] as const).map((s) => (
          <Card key={s}>
            <CardContent className="flex items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {PROTOCOL_STATUS_LABEL[s]}
                </p>
                <p className="text-2xl font-bold tabular-nums">{counts[s] ?? 0}</p>
              </div>
              <ProtocolStatusBadge status={s} />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtros + ações */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="proto-year" className="text-xs text-muted-foreground">Ano</Label>
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger id="proto-year" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="proto-status" className="text-xs text-muted-foreground">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger id="proto-status" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {Object.entries(PROTOCOL_STATUS_LABEL).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canWrite && (
          <Button className="ml-auto" onClick={() => setCreateOpen(true)}>
            <Inbox /> Nova entrada
          </Button>
        )}
      </div>

      {/* Tabela */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : protocols.length === 0 ? (
        <EmptyState
          icon={<BookOpenCheck />}
          title="Nenhuma entrada de protocolo"
          description="Registre matérias, ofícios e documentos recebidos — a numeração é automática por ano."
        />
      ) : (
        <div className="max-h-[28rem] overflow-y-auto custom-scroll rounded-lg border bg-card">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead scope="col">Nº/Ano</TableHead>
                <TableHead scope="col">Espécie</TableHead>
                <TableHead scope="col">Remetente</TableHead>
                <TableHead scope="col">Assunto</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Matéria</TableHead>
                {canWrite && <TableHead scope="col" className="text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {protocols.map((p) => (
                <TableRow key={p.id} className={p.status === 'anulado' ? 'opacity-60' : undefined}>
                  <TableCell className="whitespace-nowrap font-mono text-sm font-bold">
                    {p.number}/{p.year}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {PROTOCOL_KIND_LABEL[p.kind] ?? p.kind}
                  </TableCell>
                  <TableCell className="max-w-[10rem] truncate text-sm" title={p.senderName}>
                    {p.senderName}
                  </TableCell>
                  <TableCell className="max-w-[16rem]">
                    <p className="truncate text-sm" title={p.subject}>{p.subject}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtDateTime(p.createdAt)}</p>
                  </TableCell>
                  <TableCell>
                    <ProtocolStatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {p.matterId ? 'vinculada' : '—'}
                  </TableCell>
                  {canWrite && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {p.status === 'recebido' && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDistributing(p)}>
                            <Send className="size-3" /> Distribuir
                          </Button>
                        )}
                        {(p.status === 'recebido' || p.status === 'distribuido') && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setArchiving(p)}>
                            <Archive className="size-3" /> Arquivar
                          </Button>
                        )}
                        {p.status !== 'anulado' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            onClick={() => setAnnulling(p)}
                          >
                            <CircleSlash className="size-3" /> Anular
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Dialogs */}
      <NewProtocolDialog open={createOpen} onOpenChange={setCreateOpen} onDone={invalidate} />
      <DistributeDialog protocol={distributing} onOpenChange={(v) => !v && setDistributing(null)} onDone={invalidate} />
      <ConfirmArchiveDialog protocol={archiving} onOpenChange={(v) => !v && setArchiving(null)} onDone={invalidate} />
      <AnnulDialog protocol={annulling} onOpenChange={(v) => !v && setAnnulling(null)} onDone={invalidate} />
    </div>
  )
}

export function ProtocolStatusBadge({ status }: { status: string }) {
  if (status === 'recebido')
    return (
      <Badge variant="outline" className="gap-1 text-amber-700 dark:text-amber-400">
        <Inbox className="size-3" /> {PROTOCOL_STATUS_LABEL.recebido}
      </Badge>
    )
  if (status === 'distribuido')
    return (
      <Badge variant="outline" className="gap-1 text-emerald-700 dark:text-emerald-400">
        <Send className="size-3" /> {PROTOCOL_STATUS_LABEL.distribuido}
      </Badge>
    )
  if (status === 'arquivado')
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <Archive className="size-3" /> {PROTOCOL_STATUS_LABEL.arquivado}
      </Badge>
    )
  return (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="size-3" /> {PROTOCOL_STATUS_LABEL.anulado}
    </Badge>
  )
}

function NewProtocolDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const [kind, setKind] = useState('materia')
  const [senderName, setSenderName] = useState('')
  const [subject, setSubject] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const mattersQ = useQuery({
    queryKey: ['matters', { protocol: 'active' }],
    queryFn: () => api.listMatters(),
  })
  const matters = mattersQ.data?.matters ?? []
  const [matterId, setMatterId] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      api.createProtocol({
        kind,
        senderName: senderName.trim(),
        subject: subject.trim(),
        matterId: matterId || null,
        notes: notes.trim() || undefined,
      }),
    onSuccess: (res) => {
      toast.success('Protocolo registrado', {
        description: `Nº ${res.protocol.number}/${res.protocol.year} — numeração automática por ano.`,
      })
      setKind('materia')
      setSenderName('')
      setSubject('')
      setNotes('')
      setMatterId('')
      setErrors({})
      onOpenChange(false)
      onDone()
    },
  })

  const submit = () => {
    const errs: Record<string, string> = {}
    if (senderName.trim().length < 3) errs.senderName = 'Informe o remetente.'
    if (subject.trim().length < 5) errs.subject = 'Informe o assunto (mín. 5 caracteres).'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto custom-scroll sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova entrada de protocolo</DialogTitle>
          <DialogDescription>
            O número é gerado automaticamente por ano e tenant (sem buracos), dentro de transação.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="proto-kind">Espécie *</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger id="proto-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROTOCOL_KIND_LABEL).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="proto-sender">Remetente *</Label>
            <Input id="proto-sender" value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Ex.: Executivo Municipal" aria-invalid={!!errors.senderName} />
            {errors.senderName && <p className="text-xs text-destructive">{errors.senderName}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="proto-subject">Assunto *</Label>
            <Input id="proto-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ex.: PL 49/2026 — uso de solo" aria-invalid={!!errors.subject} />
            {errors.subject && <p className="text-xs text-destructive">{errors.subject}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="proto-matter">Matéria vinculada</Label>
            <Select value={matterId || 'nenhuma'} onValueChange={(v) => setMatterId(v === 'nenhuma' ? '' : v)}>
              <SelectTrigger id="proto-matter" className="w-full">
                <SelectValue placeholder="Sem vínculo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhuma">Sem vínculo</SelectItem>
                {matters
                  .filter((m) => m.status !== 'aprovado' && m.status !== 'rejeitado')
                  .slice(0, 100)
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.type.replace(/_/g, ' ').toUpperCase()} {m.number}/{m.year}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="proto-notes">Observações</Label>
            <Textarea id="proto-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Registrando…' : 'Registrar protocolo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DistributeDialog({
  protocol,
  onOpenChange,
  onDone,
}: {
  protocol: ProtocolEntryView | null
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const [matterId, setMatterId] = useState('')

  const mattersQ = useQuery({
    queryKey: ['matters', { protocol: 'active' }],
    queryFn: () => api.listMatters(),
    enabled: !!protocol,
  })
  const matters = (mattersQ.data?.matters ?? []).filter(
    (m) => m.status !== 'aprovado' && m.status !== 'rejeitado'
  )

  const mutation = useMutation({
    mutationFn: () =>
      api.patchProtocol(protocol!.id, { action: 'distribuir', matterId: matterId || undefined }),
    onSuccess: () => {
      toast.success('Protocolo distribuído', { description: `Nº ${protocol!.number}/${protocol!.year}` })
      setMatterId('')
      onOpenChange(false)
      onDone()
    },
  })

  return (
    <Dialog open={!!protocol} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Distribuir protocolo nº {protocol?.number}/{protocol?.year}</DialogTitle>
          <DialogDescription>
            Vincule a matéria de destino (opcional). O protocolo passa a “Distribuído”.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="dist-matter">Matéria de destino</Label>
          <Select value={matterId || 'nenhuma'} onValueChange={(v) => setMatterId(v === 'nenhuma' ? '' : v)}>
            <SelectTrigger id="dist-matter" className="w-full">
              <SelectValue placeholder="Sem vínculo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nenhuma">Sem vínculo</SelectItem>
              {matters.slice(0, 100).map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.type.replace(/_/g, ' ').toUpperCase()} {m.number}/{m.year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Distribuindo…' : 'Distribuir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmArchiveDialog({
  protocol,
  onOpenChange,
  onDone,
}: {
  protocol: ProtocolEntryView | null
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const mutation = useMutation({
    mutationFn: () => api.patchProtocol(protocol!.id, { action: 'arquivar' }),
    onSuccess: () => {
      toast.success('Protocolo arquivado', { description: `Nº ${protocol!.number}/${protocol!.year}` })
      onOpenChange(false)
      onDone()
    },
  })

  return (
    <Dialog open={!!protocol} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="size-5 text-primary" /> Arquivar protocolo nº {protocol?.number}/{protocol?.year}?
          </DialogTitle>
          <DialogDescription>
            O arquivamento encerra o fluxo da entrada. A ação é auditada e pode ser consultada na Auditoria.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Manter</Button>
          <Button variant="destructive" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Arquivando…' : 'Arquivar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AnnulDialog({
  protocol,
  onOpenChange,
  onDone,
}: {
  protocol: ProtocolEntryView | null
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const [justification, setJustification] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.patchProtocol(protocol!.id, { action: 'anular', justification: justification.trim() }),
    onSuccess: () => {
      toast.success('Protocolo anulado', {
        description: `Nº ${protocol!.number}/${protocol!.year} — justificativa registrada na auditoria.`,
      })
      setJustification('')
      setError(null)
      onOpenChange(false)
      onDone()
    },
  })

  const submit = () => {
    if (justification.trim().length < 10) {
      setError('A justificativa é obrigatória (mín. 10 caracteres).')
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <Dialog open={!!protocol} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <CircleSlash className="size-5" /> Anular protocolo nº {protocol?.number}/{protocol?.year}
          </DialogTitle>
          <DialogDescription>
            Anulação é definitiva (status terminal) e exige justificativa registrada na trilha de auditoria.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="annul-reason">Justificativa *</Label>
          <Textarea
            id="annul-reason"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            placeholder="Ex.: entrada duplicada do Ofício nº 34 — digitação incorreta do remetente."
            aria-invalid={!!error}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Manter protocolo</Button>
          <Button variant="destructive" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Anulando…' : 'Anular protocolo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
