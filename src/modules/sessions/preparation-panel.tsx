'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FileText, Send } from 'lucide-react'
import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import type { NoticeDeliveryView, SessionDocumentView, SessionStatus } from '@/lib/contracts'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function localNow() {
  const date = new Date()
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

export function PreparationPanel({ sessionId, sessionStatus }: { sessionId: string; sessionStatus: SessionStatus }) {
  const can = useApp((state) => state.can)
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<SessionDocumentView['kind']>('pauta')
  const [file, setFile] = useState<File | null>(null)
  const [recipientId, setRecipientId] = useState('')
  const [channel, setChannel] = useState<NoticeDeliveryView['channel']>('presencial')
  const [reference, setReference] = useState('')
  const [deliveredAt, setDeliveredAt] = useState(localNow)
  const [confirmed, setConfirmed] = useState(false)

  const documentsQ = useQuery({ queryKey: ['session-documents', sessionId], queryFn: () => api.sessionDocuments(sessionId) })
  const noticeQ = useQuery({ queryKey: ['notice-recipients', sessionId], queryFn: () => api.noticeRecipients(sessionId), enabled: sessionStatus !== 'draft' && can('session.transition') })
  const deliveriesQ = useQuery({ queryKey: ['notice-deliveries', sessionId], queryFn: () => api.noticeDeliveries(sessionId), enabled: sessionStatus !== 'draft' && can('session.transition') })
  const upload = useMutation({
    mutationFn: () => api.uploadSessionDocument(sessionId, kind, file!),
    onSuccess: ({ document }) => {
      toast.success(`Documento ${document.kind} v${document.version} anexado`)
      setFile(null)
      queryClient.invalidateQueries({ queryKey: ['session-documents', sessionId] })
    },
  })
  const attest = useMutation({
    mutationFn: () => api.attestNoticeDelivery(sessionId, {
      revision: noticeQ.data!.revision!, noticeSha256: noticeQ.data!.noticeSha256!, parliamentarianId: recipientId,
      channel, evidenceReference: reference.trim(), deliveredAt: new Date(deliveredAt).toISOString(),
      commandId: crypto.randomUUID(), acknowledged: true,
    }),
    onSuccess: () => {
      toast.success('Comprovante de entrega externa registrado')
      setReference('')
      setRecipientId('')
      setConfirmed(false)
      queryClient.invalidateQueries({ queryKey: ['notice-deliveries', sessionId] })
    },
  })
  const download = async (document: SessionDocumentView) => {
    try {
      const blob = await api.downloadSessionDocument(sessionId, document.id)
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = document.name
      window.document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      toast.error('Não foi possível baixar o documento')
    }
  }

  const documents = documentsQ.data?.documents ?? []
  const recipients = noticeQ.data?.recipients ?? []
  const deliveries = deliveriesQ.data?.deliveries ?? []
  return <div className="space-y-4">
    <section className="space-y-2 rounded-md border p-3" aria-label="Documentos da sessão">
      <h4 className="flex items-center gap-2 text-sm font-semibold"><FileText className="size-4" /> Documentos da sessão</h4>
      <p className="text-xs text-muted-foreground">PDFs ficam versionados e vinculados por hash à convocação publicada. Até 5 MB por arquivo.</p>
      {sessionStatus === 'draft' && can('session.create') && <div className="grid gap-2 sm:grid-cols-[11rem_1fr_auto]">
        <select aria-label="Tipo do documento" className="rounded-md border bg-background px-2 text-sm" value={kind} onChange={(event) => setKind(event.target.value as SessionDocumentView['kind'])}>
          <option value="pauta">Pauta</option><option value="convocacao">Convocação</option><option value="apoio">Apoio</option>
        </select>
        <Input type="file" accept="application/pdf,.pdf" aria-label="Arquivo PDF" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <Button size="sm" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>{upload.isPending ? 'Enviando…' : 'Anexar PDF'}</Button>
      </div>}
      {documents.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum PDF anexado.</p> : <ul className="space-y-1 text-xs">
        {documents.map((document) => <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1">
          <span>{document.kind} v{document.version} · {document.name} · SHA-256 {document.sha256.slice(0, 12)}…</span>
          <Button size="sm" variant="ghost" onClick={() => download(document)}>Baixar</Button>
        </li>)}
      </ul>}
    </section>
    {sessionStatus !== 'draft' && can('session.transition') && <section className="space-y-2 rounded-md border p-3" aria-label="Comprovantes de entrega">
      <h4 className="flex items-center gap-2 text-sm font-semibold"><Send className="size-4" /> Entrega da convocação · revisão {noticeQ.data?.revision ?? '—'}</h4>
      <p className="text-xs text-muted-foreground">Registro manual de entrega feita fora do sistema. A referência informada é uma declaração do operador; o sistema ainda não envia nem verifica e-mails ou mensagens.</p>
      {recipients.length > 0 && <div className="grid gap-2 sm:grid-cols-2">
        {recipients.map((recipient) => {
          const sent = deliveries.filter((item) => item.parliamentarianId === recipient.parliamentarianId)
          return <p key={recipient.parliamentarianId} className="rounded border p-2 text-xs">{recipient.name} · {sent.length} comprovante(s) · {recipient.acknowledgedAt ? 'ciência registrada' : 'ciência pendente'}</p>
        })}
      </div>}
      {noticeQ.data?.revision && noticeQ.data.noticeSha256 && <div className="grid gap-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-2">
        <div className="grid gap-1"><Label htmlFor="delivery-recipient">Destinatário</Label><select id="delivery-recipient" className="h-9 rounded-md border bg-background px-2 text-sm" value={recipientId} onChange={(event) => setRecipientId(event.target.value)}><option value="">Selecione</option>{recipients.map((person) => <option key={person.parliamentarianId} value={person.parliamentarianId}>{person.name}</option>)}</select></div>
        <div className="grid gap-1"><Label htmlFor="delivery-channel">Canal externo</Label><select id="delivery-channel" className="h-9 rounded-md border bg-background px-2 text-sm" value={channel} onChange={(event) => setChannel(event.target.value as NoticeDeliveryView['channel'])}><option value="presencial">Presencial</option><option value="email_externo">E-mail externo</option><option value="mensagem_externa">Mensagem externa</option><option value="outro">Outro</option></select></div>
        <div className="grid gap-1"><Label htmlFor="delivery-reference">Referência do comprovante</Label><Input id="delivery-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Ex.: protocolo ou identificador externo" /></div>
        <div className="grid gap-1"><Label htmlFor="delivery-at">Data e hora declaradas</Label><Input id="delivery-at" type="datetime-local" value={deliveredAt} onChange={(event) => setDeliveredAt(event.target.value)} /></div>
        <label className="flex items-center gap-2 text-xs sm:col-span-2"><Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} /> Confirmo que conferi a referência do comprovante externo.</label>
        <Button size="sm" className="justify-self-start sm:col-span-2" disabled={!recipientId || reference.trim().length < 5 || !deliveredAt || !confirmed || attest.isPending} onClick={() => attest.mutate()}>Registrar entrega externa</Button>
      </div>}
      {deliveries.length > 0 && <ul className="space-y-1 text-xs">{deliveries.map((item) => <li key={item.id}>{new Date(item.deliveredAt).toLocaleString('pt-BR')} · {item.channel} · {item.evidenceReference} · {item.recordedByName}</li>)}</ul>}
    </section>}
  </div>
}
