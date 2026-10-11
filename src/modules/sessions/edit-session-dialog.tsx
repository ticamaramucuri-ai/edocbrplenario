'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { SESSION_TYPE_LABEL, type SessionSummary, type SessionType } from '@/lib/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

function localDateTime(iso: string) {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function EditSessionDialog({ session, onClose }: { session: SessionSummary; onClose: () => void }) {
  const queryClient = useQueryClient()
  const enabledTypes = useApp((state) => state.bootstrap?.tenant?.settings.enabledSessionTypes ?? (Object.keys(SESSION_TYPE_LABEL) as SessionType[]))
  const [type, setType] = useState(session.type)
  const [scheduledAt, setScheduledAt] = useState(localDateTime(session.scheduledAt))
  const [presidentId, setPresidentId] = useState(session.presidentId ?? '')
  const [secretaryName, setSecretaryName] = useState(session.secretaryName ?? '')
  const [location, setLocation] = useState(session.location)
  const [notes, setNotes] = useState(session.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const parliamentarians = useQuery({ queryKey: ['parliamentarians'], queryFn: () => api.listParliamentarians() })
  const active = (parliamentarians.data?.parliamentarians ?? []).filter((person) => person.active)

  const mutation = useMutation({
    mutationFn: () => api.updateSession(session.id, {
      version: session.version, ...(type !== session.type && { type }), scheduledAt: new Date(scheduledAt).toISOString(), presidentId,
      secretaryName: secretaryName.trim() || null, location: location.trim(), notes: notes.trim() || null,
    }),
    onSuccess: () => {
      toast.success('Rascunho atualizado')
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['session', session.id] })
      onClose()
    },
    onError: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  })

  const submit = () => {
    if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) return setError('Informe uma data e hora válidas.')
    if (!presidentId) return setError('Selecione o presidente da sessão.')
    if (!location.trim()) return setError('Informe o local da sessão.')
    setError(null)
    mutation.mutate()
  }

  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Editar rascunho {session.number}/{session.year}</DialogTitle>
        <DialogDescription>Revise os dados da sessão antes de publicar a pauta. O número anual permanece o mesmo.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2"><Label htmlFor="edit-session-type">Tipo</Label>
          <Select value={type} onValueChange={(value) => setType(value as SessionType)}><SelectTrigger id="edit-session-type"><SelectValue /></SelectTrigger><SelectContent>
            {(Object.keys(SESSION_TYPE_LABEL) as SessionType[]).filter((item) => enabledTypes.includes(item) || item === session.type).map((item) => <SelectItem key={item} value={item}>{SESSION_TYPE_LABEL[item]}{!enabledTypes.includes(item) ? ' (desabilitado)' : ''}</SelectItem>)}
          </SelectContent></Select>
        </div>
        <div className="grid gap-2"><Label htmlFor="edit-session-date">Data e hora</Label><Input id="edit-session-date" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></div>
        <div className="grid gap-2"><Label htmlFor="edit-session-president">Presidente</Label>
          <Select value={presidentId} onValueChange={setPresidentId}><SelectTrigger id="edit-session-president"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>
            {active.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}
          </SelectContent></Select>
        </div>
        <div className="grid gap-2"><Label htmlFor="edit-session-secretary">Secretário(a)</Label><Input id="edit-session-secretary" value={secretaryName} onChange={(event) => setSecretaryName(event.target.value)} /></div>
      </div>
      <div className="grid gap-2"><Label htmlFor="edit-session-location">Local</Label><Input id="edit-session-location" value={location} onChange={(event) => setLocation(event.target.value)} /></div>
      <div className="grid gap-2"><Label htmlFor="edit-session-notes">Observações</Label><Textarea id="edit-session-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={mutation.isPending} onClick={submit}>Salvar rascunho</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
