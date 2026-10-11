'use client'

/**
 * Dialog compartilhado "Registrar andamento" — usado no módulo Protocolo e
 * Tramitação e no drawer de detalhe da matéria (módulo Matérias).
 * toStatus filtrado pela máquina de estados (cópia client-side da matriz de
 * src/lib/server/domain.ts — a validação real é server-side).
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { GitBranch } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { MATTER_STATUS_LABEL, PROCEEDING_ACTION_LABEL, type MatterView } from '@/lib/contracts'
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
import { Textarea } from '@/components/ui/textarea'

/** Matriz espelhada de MATTER_STATUS_TRANSITIONS (src/lib/server/domain.ts). */
export const MATTER_TARGETS: Record<string, string[]> = {
  em_tramitacao: ['incluida_pauta', 'arquivado', 'retirado'],
  incluida_pauta: ['aprovado', 'rejeitado', 'retirado', 'em_tramitacao'],
  arquivado: ['em_tramitacao'],
  aprovado: [],
  rejeitado: [],
  retirado: [],
  sancionado: [],
  vetado: [],
}

// Fase 17: sancionado/vetado são terminais — o desfecho (sanção/veto) é
// registrado pela seção "Desfecho" do drawer (POST /matters/:id/outcomes).
export const MATTER_TERMINALS = ['aprovado', 'rejeitado', 'retirado', 'sancionado', 'vetado']

export function matterTargets(status: string): string[] {
  return [status, ...(MATTER_TARGETS[status] ?? [])]
}

export function ProceedingDialog({
  matter,
  open,
  onOpenChange,
}: {
  matter: MatterView | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const can = useApp((s) => s.can)
  const canWrite = can('matter.write')
  const queryClient = useQueryClient()

  const [action, setAction] = useState('despacho')
  const [toStatus, setToStatus] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [documentRef, setDocumentRef] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [error, setError] = useState<string | null>(null)

  const targets = matter ? matterTargets(matter.status) : []

  const mutation = useMutation({
    mutationFn: () =>
      api.createProceeding(matter!.id, {
        action,
        toStatus,
        notes: notes.trim() || undefined,
        documentRef: documentRef.trim() || undefined,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      }),
    onSuccess: (res) => {
      const changed = res.proceeding.toStatus !== res.proceeding.fromStatus
      toast.success('Andamento registrado', {
        description: `Seq ${res.proceeding.seq} — ${PROCEEDING_ACTION_LABEL[res.proceeding.action] ?? res.proceeding.action}${
          changed ? ` · situação: ${MATTER_STATUS_LABEL[res.proceeding.toStatus]}` : ''
        }`,
      })
      queryClient.invalidateQueries({ queryKey: ['proceedings', matter!.id] })
      queryClient.invalidateQueries({ queryKey: ['matters'] })
      queryClient.invalidateQueries({ queryKey: ['workflow'] })
      reset()
      onOpenChange(false)
    },
  })

  const reset = () => {
    setAction('despacho')
    setToStatus('')
    setNotes('')
    setDocumentRef('')
    setDueAt('')
    setError(null)
  }

  const submit = () => {
    if (!toStatus) {
      setError('Selecione a situação de destino.')
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="size-5 text-primary" /> Registrar andamento
          </DialogTitle>
          <DialogDescription>
            {matter && (
              <>
                A tramitação é <strong>append-only</strong>: o andamento recebe seq subsequente e, se a situação
                mudar, a matéria é atualizada conforme a máquina de estados (validada no servidor).
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {matter && (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="font-mono font-bold">{`${matter.type.toUpperCase()} ${matter.number}/${matter.year}`}</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{matter.ementa}</p>
            <p className="mt-1 text-xs">
              Situação atual:{' '}
              <strong>{MATTER_STATUS_LABEL[matter.status] ?? matter.status}</strong>
            </p>
          </div>
        )}

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="proc-action">Ação *</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger id="proc-action" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PROCEEDING_ACTION_LABEL).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proc-status">Situação de destino *</Label>
              <Select value={toStatus} onValueChange={setToStatus}>
                <SelectTrigger id="proc-status" className="w-full">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === matter?.status ? `${MATTER_STATUS_LABEL[s]} (mantém)` : MATTER_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="proc-notes">Observações</Label>
            <Textarea
              id="proc-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Ex.: parecer favorável da CCJ, com 2 emendas."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="proc-docref">Documento de referência</Label>
              <Input
                id="proc-docref"
                value={documentRef}
                onChange={(e) => setDocumentRef(e.target.value)}
                placeholder="Ex.: Parecer CCJ nº 12/2026"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proc-due">Prazo (opcional)</Label>
              <Input id="proc-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={mutation.isPending || !canWrite}>
            {mutation.isPending ? 'Registrando…' : 'Registrar andamento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
