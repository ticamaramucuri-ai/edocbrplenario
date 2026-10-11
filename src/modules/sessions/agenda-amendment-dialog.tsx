'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import type { AgendaItemView } from '@/lib/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type Action = 'add' | 'move' | 'retire'
type Preview = { before: Array<{ id: string; title: string; status: string }>; after: Array<{ id: string; title: string; status: string }>; revision: number; summary: string }

export function AgendaAmendmentDialog({ sessionId, version, agenda, onClose }: {
  sessionId: string; version: number; agenda: AgendaItemView[]; onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [action, setAction] = useState<Action>('add')
  const [matterId, setMatterId] = useState('')
  const [itemId, setItemId] = useState('')
  const [position, setPosition] = useState('0')
  const [justification, setJustification] = useState('')
  const [exceptionReason, setExceptionReason] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const matters = useQuery({ queryKey: ['matters', 'amendment'], queryFn: () => api.listMatters({ status: 'em_tramitacao' }), enabled: action === 'add' })
  const orderItems = agenda.filter((item) => item.section === 'ordem_do_dia')
  const available = (matters.data?.matters ?? []).filter((matter) => !agenda.some((item) => item.matterId === matter.id))

  const command = (mode: 'preview' | 'apply') => ({
    action, mode, version, justification: justification.trim(),
    ...(exceptionReason.trim() && { exceptionReason: exceptionReason.trim() }),
    ...(action === 'add' && { matterId }),
    ...(action !== 'add' && { itemId }),
    ...(action === 'move' && { position: Number(position) }),
  })
  const mutation = useMutation({
    mutationFn: (mode: 'preview' | 'apply') => api.amendAgenda(sessionId, command(mode)),
    onSuccess: (result, mode) => {
      if (mode === 'preview') setPreview(result.preview ?? null)
      else {
        toast.success(`Pauta atualizada — revisão ${result.amendment?.revision}`)
        queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
        queryClient.invalidateQueries({ queryKey: ['sessions'] })
        queryClient.invalidateQueries({ queryKey: ['matters'] })
        onClose()
      }
    },
    onError: () => {
      setPreview(null)
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
  })
  const submit = (mode: 'preview' | 'apply') => {
    if (justification.trim().length < 3) return setError('Informe a justificativa (mínimo de 3 caracteres).')
    if (exceptionReason.trim().length > 0 && exceptionReason.trim().length < 3) return setError('A justificativa da exceção deve ter no mínimo 3 caracteres.')
    if (action === 'add' && !matterId) return setError('Selecione uma matéria.')
    if (action !== 'add' && !itemId) return setError('Selecione um item da Ordem do Dia.')
    if (action === 'move' && (!Number.isInteger(Number(position)) || Number(position) < 0)) return setError('Informe uma posição válida.')
    setError(null)
    mutation.mutate(mode)
  }
  const resetPreview = () => setPreview(null)

  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>Emendar pauta publicada</DialogTitle><DialogDescription>Disponível até a abertura do credenciamento. Confira a prévia antes de confirmar; a alteração gera uma nova revisão pública.</DialogDescription></DialogHeader>
    <div className="grid gap-3">
      <div className="grid gap-2"><Label>Alteração</Label><Select value={action} onValueChange={(value) => { setAction(value as Action); resetPreview() }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="add">Incluir matéria</SelectItem><SelectItem value="move">Reordenar matéria</SelectItem><SelectItem value="retire">Retirar matéria</SelectItem>
      </SelectContent></Select></div>
      {action === 'add' ? <div className="grid gap-2"><Label>Matéria</Label><Select value={matterId} onValueChange={(value) => { setMatterId(value); resetPreview() }}><SelectTrigger><SelectValue placeholder="Selecione uma matéria em tramitação" /></SelectTrigger><SelectContent>
        {available.map((matter) => <SelectItem key={matter.id} value={matter.id}>{matter.number}/{matter.year} — {matter.ementa.slice(0, 65)}</SelectItem>)}
      </SelectContent></Select></div> : <div className="grid gap-2"><Label>Item da Ordem do Dia</Label><Select value={itemId} onValueChange={(value) => { setItemId(value); resetPreview() }}><SelectTrigger><SelectValue placeholder="Selecione um item" /></SelectTrigger><SelectContent>
        {orderItems.map((item) => <SelectItem key={item.id} value={item.id}>{item.title.slice(0, 85)}</SelectItem>)}
      </SelectContent></Select></div>}
      {action === 'move' && <div className="grid gap-2"><Label htmlFor="amend-position">Nova posição na Ordem do Dia (a partir de 1)</Label><Input id="amend-position" type="number" min="1" max={orderItems.length} value={String(Number(position) + 1)} onChange={(event) => { setPosition(String(Number(event.target.value) - 1)); resetPreview() }} /></div>}
      <div className="grid gap-2"><Label htmlFor="amend-reason">Justificativa *</Label><Textarea id="amend-reason" value={justification} onChange={(event) => { setJustification(event.target.value); resetPreview() }} rows={2} /></div>
      <div className="grid gap-2"><Label htmlFor="amend-exception-reason">Exceção de prazo por urgência (se necessária)</Label><Textarea id="amend-exception-reason" value={exceptionReason} onChange={(event) => { setExceptionReason(event.target.value); resetPreview() }} rows={2} placeholder="Informe apenas se a retificação ocorrer fora do prazo mínimo e a Câmara admitir exceção para este tipo." /><p className="text-xs text-muted-foreground">A justificativa da exceção ficará pública na convocação.</p></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {preview && <div className="rounded-md border bg-muted/40 p-3 text-sm"><p className="font-semibold">Prévia da revisão {preview.revision}</p><p>{preview.summary}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {([{ label: 'Antes', items: preview.before }, { label: 'Depois', items: preview.after }] as const).map((column) => <div key={column.label}>
            <p className="mb-1 font-medium">{column.label}</p><ol className="max-h-40 space-y-1 overflow-y-auto text-xs">
              {column.items.map((item, index) => <li key={item.id} className="rounded bg-background px-2 py-1">{index + 1}. {item.title}{item.status === 'retirado' ? ' (retirado)' : ''}</li>)}
            </ol>
          </div>)}
        </div>
        <p className="mt-2 text-muted-foreground">A justificativa ficará pública.</p></div>}
    </div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button variant="secondary" disabled={mutation.isPending} onClick={() => submit('preview')}>Ver prévia</Button><Button disabled={!preview || mutation.isPending} onClick={() => submit('apply')}>Confirmar emenda</Button></DialogFooter>
  </DialogContent></Dialog>
}
