'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Radio, RefreshCw, Signal, SignalZero } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

const LABELS = {
  draft: 'Ainda não preparada',
  ready: 'Preparada para verificar o sinal',
  monitoring: 'Acompanhando sinal local',
  signal_lost: 'Sinal local perdido',
  ended: 'Acompanhamento encerrado',
} as const

export function TransmissionTab({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [observationDestinationId, setObservationDestinationId] = useState<string | null>(null)
  const [observationNote, setObservationNote] = useState('')
  const [videoChecked, setVideoChecked] = useState(false)
  const [audioChecked, setAudioChecked] = useState(false)
  const can = useApp((state) => state.can)
  const actorId = useApp((state) => state.actor?.id)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['transmission', sessionId],
    queryFn: () => api.getTransmission(sessionId),
    refetchInterval: 3000,
  })
  const destinations = useQuery({
    queryKey: ['media-destinations', sessionId],
    queryFn: () => api.getMediaDestinations(sessionId),
    refetchInterval: 3000,
  })
  const observations = useQuery({
    queryKey: ['media-public-observations', sessionId],
    queryFn: () => api.getMediaPublicObservations(sessionId),
    refetchInterval: 5000,
  })
  const recording = useQuery({
    queryKey: ['media-recording', sessionId],
    queryFn: () => api.getMediaRecording(sessionId),
    refetchInterval: 10000,
  })
  const archive = useQuery({
    queryKey: ['recording-archive', sessionId],
    queryFn: () => api.getRecordingArchive(sessionId),
  })
  const readiness = useQuery({
    queryKey: ['session-readiness', sessionId],
    queryFn: () => api.getSessionReadiness(sessionId),
    refetchInterval: 5000,
  })

  async function archiveCommand(action: 'build' | 'publish' | 'withdraw') {
    if (archiveBusy) return
    const current = archive.data?.recording
    let gapJustification: string | undefined
    if (action === 'publish') {
      if (current?.gapCount) {
        const answer = window.prompt(`Foram detectadas ${current.gapCount} lacuna(s). Registre uma justificativa para publicar:`)
        if (!answer || answer.trim().length < 10) return
        gapJustification = answer.trim()
      }
      if (!window.confirm('Você conferiu o replay completo, incluindo vídeo e áudio, e autoriza sua publicação?')) return
    }
    setArchiveBusy(true)
    try {
      await api.commandRecordingArchive(sessionId, { action, version: current?.version ?? 1, idempotencyKey: crypto.randomUUID(), gapJustification })
      await queryClient.invalidateQueries({ queryKey: ['recording-archive', sessionId] })
      toast.success(action === 'build' ? 'Replay preparado e manifesto registrado.' : action === 'publish' ? 'Replay publicado no portal.' : 'Replay retirado do portal.')
    } catch {
      // A API apresenta o erro operacional.
    } finally { setArchiveBusy(false) }
  }

  async function command(action: 'prepare' | 'start_monitoring' | 'stop_monitoring') {
    if (!data || busy) return
    setBusy(true)
    try {
      await api.commandTransmission(sessionId, {
        action,
        version: data.transmission.version,
        idempotencyKey: crypto.randomUUID(),
      })
      await queryClient.invalidateQueries({ queryKey: ['transmission', sessionId] })
      toast.success('Estado do acompanhamento atualizado.')
    } catch {
      // O cliente da API já apresenta o problema retornado pelo servidor.
    } finally {
      setBusy(false)
    }
  }

  async function setDestination(destinationId: string, enabled: boolean) {
    if (busy) return
    setBusy(true)
    try {
      await api.setMediaDestination(sessionId, destinationId, enabled)
      await queryClient.invalidateQueries({ queryKey: ['media-destinations', sessionId] })
      toast.success(enabled ? 'Ativação registrada; aguardando confirmação.' : 'Desativação registrada; aguardando confirmação.')
    } catch {
      // O cliente da API já apresenta o problema retornado pelo servidor.
    } finally {
      setBusy(false)
    }
  }

  async function setPublicLink(action: 'publish' | 'withdraw', destinationId?: string) {
    if (!data || busy) return
    const observation = action === 'publish' && data.transmission.official
      ? observations.data?.observations.find((item) => item.destinationId === destinationId &&
        item.observerId !== actorId && item.destinationGeneration === destinations.data?.destinations.find((destination) => destination.id === destinationId)?.generation &&
        item.publicUrl === destinations.data?.destinations.find((destination) => destination.id === destinationId)?.publicUrl &&
        Date.now() - new Date(item.observedAt).getTime() <= 10 * 60_000)
      : undefined
    if (action === 'publish' && data.transmission.official && !observation) {
      toast.error('Outra pessoa deve registrar vídeo e áudio na página pública nos últimos 10 minutos.')
      return
    }
    if (action === 'publish' && !window.confirm('Você conferiu vídeo e áudio da transmissão na página pública da plataforma?')) return
    setBusy(true)
    try {
      await api.setTransmissionPublicLink(sessionId, {
        action, destinationId, platformConfirmed: action === 'publish',
        observationId: observation?.id,
        version: data.transmission.version, idempotencyKey: crypto.randomUUID(),
      })
      await queryClient.invalidateQueries({ queryKey: ['transmission', sessionId] })
      toast.success(action === 'publish' ? 'Link público publicado no portal.' : 'Link público retirado do portal.')
    } catch {
      // A API apresenta o erro operacional.
    } finally { setBusy(false) }
  }

  async function recordObservation(destinationId: string) {
    if (busy || !videoChecked || !audioChecked || observationNote.trim().length < 10) return
    setBusy(true)
    try {
      await api.recordMediaPublicObservation(sessionId, { destinationId, videoOk: true, audioOk: true, evidenceNote: observationNote.trim() })
      await queryClient.invalidateQueries({ queryKey: ['media-public-observations', sessionId] })
      setObservationDestinationId(null)
      setObservationNote('')
      setVideoChecked(false)
      setAudioChecked(false)
      toast.success('Conferência externa registrada para este destino.')
    } catch {
      // A API apresenta o erro operacional.
    } finally { setBusy(false) }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Verificando a fonte de mídia…</p>
  if (isError || !data) {
    return <Button variant="outline" onClick={() => void refetch()}><RefreshCw /> Recarregar transmissão</Button>
  }

  const { transmission, source } = data
  const forwarding = destinations.data?.destinations.filter((item) => item.desiredEnabled && item.syncStatus === 'applied' && item.enabled && item.state === 'forwarding') ?? []
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader><h2 className="text-base font-semibold leading-none">Prontidão da sessão</h2></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {readiness.isLoading && <p role="status">Conferindo pauta, quórum e mídia…</p>}
          {readiness.isError && <p role="alert">Não foi possível conferir a prontidão. Recarregue antes de operar.</p>}
          {readiness.data && <>
            <p role="status" className="font-medium">Sessão: {readiness.data.sessionReady ? 'sem bloqueio identificado' : 'há bloqueios'} · Transporte local: {readiness.data.broadcastReady ? 'pronto' : 'requer atenção'}</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {readiness.data.checks.map((check) => <li key={check.id} className="rounded border p-2">
                <p className="font-medium">{check.area === 'legislative' ? 'Sessão' : 'Mídia'} · {check.state === 'ok' ? 'OK' : check.state === 'blocked' ? 'Bloqueio' : 'Atenção'}</p>
                <p>{check.message}</p>
                {check.action && <p className="text-muted-foreground">Próximo passo: {check.action}</p>}
              </li>)}
            </ul>
            <p className="text-xs text-muted-foreground">Conferido às {new Date(readiness.data.checkedAt).toLocaleTimeString('pt-BR')}. Transporte local pronto ainda exige conferência de vídeo e áudio na plataforma pública.</p>
          </>}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><h2 className="text-base font-semibold leading-none">Conferência da transmissão</h2></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>Fonte local: <strong>{source.ready ? 'pronta' : 'aguardando sinal'}</strong></p>
          <p>Destinos RTMPS confirmados pelo controlador: <strong>{forwarding.length}</strong></p>
          <p>Link público: <strong>{transmission.publicLink
            ? transmission.official && !transmission.publicLink.observationId ? 'legado sem conferência; oculto no portal' : 'publicado após conferência externa'
            : 'não publicado'}</strong></p>
          <p>Gravação: <strong>{recording.data?.configured ? `${recording.data.segmentCount} segmento(s) catalogado(s)` : 'não confirmada'}</strong></p>
          <p className="text-muted-foreground">Saída RTMPS e segmentos locais não comprovam que o vídeo e o áudio estão disponíveis para o público. Confira a página da rede social em outro dispositivo antes de publicar o link.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><h2 className="flex items-center gap-2 text-base font-semibold leading-none"><Radio className="size-4" /> Acompanhamento local</h2></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="font-medium" role="status">{LABELS[transmission.effectiveStatus]}</p>
          <p className="text-muted-foreground">O acompanhamento confirma o sinal recebido pelo servidor local. Os destinos RTMPS são controlados abaixo.</p>
          <div className="flex flex-wrap gap-2">
            {transmission.status === 'draft' && <Button disabled={busy} onClick={() => void command('prepare')}>Preparar acompanhamento</Button>}
            {transmission.status === 'ready' && <Button disabled={busy || !source.ready} onClick={() => void command('start_monitoring')}>Confirmar sinal e acompanhar</Button>}
            {transmission.status === 'monitoring' && <Button variant="outline" disabled={busy || !destinations.data || !destinations.data.controllerAvailable || destinations.data.destinations.some((item) => item.desiredEnabled || item.enabled !== false)} onClick={() => void command('stop_monitoring')}>Encerrar acompanhamento</Button>}
          </div>
          {transmission.status === 'ended' && <p className="text-muted-foreground">O registro desta sessão foi encerrado. A parada do encoder deve ser conferida na estação de mídia.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><h2 className="flex items-center gap-2 text-base font-semibold leading-none">{source.ready ? <Signal className="size-4 text-emerald-600" /> : <SignalZero className="size-4 text-amber-600" />} Fonte MediaMTX</h2></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Sinal: <strong>{source.ready ? 'pronto' : 'ausente'}</strong></p>
          <p>Caminho de publicação: <code className="break-all rounded bg-muted px-1">{source.path}</code></p>
          {source.inboundBytes !== null && <p>Recebidos: {new Intl.NumberFormat('pt-BR').format(source.inboundBytes)} bytes</p>}
          <p className="text-muted-foreground">Última verificação: {new Date(source.checkedAt).toLocaleTimeString('pt-BR')}</p>
          {!source.configured && <p className="text-amber-700">Configure MEDIA_METRICS_URL no servidor para habilitar a verificação.</p>}
          {source.error && <p className="text-destructive">{source.error}</p>}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><h2 className="text-base font-semibold leading-none">Destinos de transmissão</h2></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">O estado “encaminhando” confirma a saída RTMPS do MediaMTX. A live pública deve ser conferida também na plataforma.</p>
          {transmission.official && <p className="text-muted-foreground">Na sessão oficial, uma pessoa registra a observação da página pública e outra publica o link em até 10 minutos.</p>}
          {transmission.publicLink && <div className="rounded border border-emerald-600/40 bg-emerald-50 p-3 dark:bg-emerald-950/20">
            <p className="font-medium">Link publicado no portal</p>
            <a href={transmission.publicLink.url} target="_blank" rel="noopener noreferrer" className="break-all underline">{transmission.publicLink.url}</a>
            {transmission.publicLink.observationId && <p className="text-xs">Conferência vinculada: {observations.data?.observations.find((item) => item.id === transmission.publicLink?.observationId)?.observerName ?? transmission.publicLink.observationId}</p>}
            {can('media.manage') && <div className="mt-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void setPublicLink('withdraw')}>Retirar link</Button></div>}
          </div>}
          {destinations.data && !destinations.data.controllerAvailable && <p className="text-destructive">Controlador indisponível ({destinations.data.controllerErrorCode}). As solicitações permanecem registradas e serão repetidas pelo worker.</p>}
          {destinations.isLoading && <p>Consultando destinos…</p>}
          {destinations.isError && <p className="text-destructive">Não foi possível consultar o controlador de mídia. Confira a configuração do servidor e recarregue.</p>}
          {destinations.data?.destinations.length === 0 && <p className="text-muted-foreground">Nenhum destino configurado para esta Câmara.</p>}
          {destinations.data?.destinations.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3">
              <div>
                <p className="font-medium">{item.label} <span className="text-muted-foreground">({item.platform})</span></p>
                <p role="status" className="text-muted-foreground">{item.state === 'disabled' ? 'Desativado' : item.state === 'forwarding' ? 'Encaminhando' : item.state === 'error' ? 'Erro no encaminhamento' : item.state === 'unknown' ? 'Estado externo desconhecido' : 'Aguardando sinal/conexão'}{item.outboundBytes !== null ? ` · ${new Intl.NumberFormat('pt-BR').format(item.outboundBytes)} bytes enviados` : ''}</p>
                <p className="text-xs text-muted-foreground">Solicitado: {item.desiredEnabled ? 'ativo' : 'inativo'} · Reconciliação: {item.syncStatus === 'unmanaged' ? 'sem comando' : item.syncStatus === 'pending' ? 'pendente' : item.syncStatus === 'applied' ? 'aplicada' : 'erro'}{item.lastErrorCode ? ` (${item.lastErrorCode})` : ''}</p>
                {!item.hasPublicUrl && <p className="text-xs text-muted-foreground">URL pública deste evento ainda não configurada.</p>}
                {item.publicUrl && <a href={item.publicUrl} target="_blank" rel="noopener noreferrer" className="block max-w-lg break-all text-xs underline">Abrir página pública do evento</a>}
                {observations.data?.observations.find((observation) => observation.destinationId === item.id) && <p className="text-xs text-muted-foreground">Última conferência: {observations.data.observations.find((observation) => observation.destinationId === item.id)?.observerName}, {new Date(observations.data.observations.find((observation) => observation.destinationId === item.id)!.observedAt).toLocaleString('pt-BR')}</p>}
              </div>
              {can('media.manage') && <div className="flex flex-wrap gap-2">
                <Button variant={item.desiredEnabled || item.enabled === true ? 'outline' : 'default'} disabled={busy || (!(item.desiredEnabled || item.enabled === true) && (transmission.status !== 'monitoring' || !source.ready))} onClick={() => void setDestination(item.id, !(item.desiredEnabled || item.enabled === true))}>{item.desiredEnabled || item.enabled === true ? 'Desativar' : 'Ativar'}</Button>
                {item.hasPublicUrl && <Button variant="outline" disabled={busy || transmission.status !== 'monitoring' || !source.ready || !item.desiredEnabled || item.syncStatus !== 'applied' || item.state !== 'forwarding'} onClick={() => { setObservationDestinationId(item.id); setObservationNote(''); setVideoChecked(false); setAudioChecked(false) }}>Registrar conferência externa</Button>}
                {item.hasPublicUrl && <Button variant="outline" disabled={busy || transmission.status !== 'monitoring' || !source.ready || !item.desiredEnabled || item.syncStatus !== 'applied' || item.state !== 'forwarding'} onClick={() => void setPublicLink('publish', item.id)}>Publicar link</Button>}
              </div>}
              {observationDestinationId === item.id && <div className="w-full space-y-2 rounded border bg-muted/40 p-3">
                <p className="font-medium">Conferência em outro dispositivo, na página pública</p>
                <label className="flex items-center gap-2"><input type="checkbox" checked={videoChecked} onChange={(event) => setVideoChecked(event.target.checked)} /> Vídeo visível e contínuo</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={audioChecked} onChange={(event) => setAudioChecked(event.target.checked)} /> Áudio audível e inteligível</label>
                <label className="block">Referência do ensaio ou observação
                  <input className="mt-1 w-full rounded border bg-background p-2" maxLength={500} value={observationNote} onChange={(event) => setObservationNote(event.target.value)} placeholder="Ex.: celular na rede móvel, áudio conferido às 14h" />
                </label>
                <Button size="sm" disabled={busy || !videoChecked || !audioChecked || observationNote.trim().length < 10} onClick={() => void recordObservation(item.id)}>Salvar conferência</Button>
              </div>}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><h2 className="text-base font-semibold leading-none">Gravação local</h2></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {recording.isLoading && <p>Consultando segmentos…</p>}
          {recording.isError && <p className="text-destructive">Catálogo de gravações indisponível. Confira o MediaMTX e o disco local.</p>}
          {recording.data && <>
            <p>Gravação configurada: <strong>{recording.data.configured ? 'sim' : 'não'}</strong></p>
            <p>Segmentos encontrados: <strong>{recording.data.segmentCount}</strong></p>
            {recording.data.latestSegmentAt && <p>Último segmento iniciado: {new Date(recording.data.latestSegmentAt).toLocaleString('pt-BR')}</p>}
            <p className="text-muted-foreground">O catálogo indica segmentos associados à sessão. A integridade e o áudio do arquivo exigem verificação separada.</p>
          </>}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><h2 className="text-base font-semibold leading-none">Replay local verificável</h2></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {archive.isLoading && <p>Consultando manifesto…</p>}
          {archive.isError && <p className="text-destructive">Não foi possível consultar o replay local.</p>}
          {!archive.data?.recording && <p className="text-muted-foreground">Nenhum replay preparado. Encerre a sessão e o acompanhamento da mídia antes de gerar o manifesto.</p>}
          {archive.data?.recording && <>
            <p>Estado: <strong>{archive.data.recording.status === 'published' ? 'publicado' : archive.data.recording.status === 'withdrawn' ? 'retirado' : 'verificado, aguardando publicação'}</strong></p>
            <p>Segmentos: {archive.data.recording.segmentCount} · Duração catalogada: {Math.round(archive.data.recording.durationSeconds)} s · Lacunas: {archive.data.recording.gapCount}</p>
            <p className="break-all text-xs text-muted-foreground">SHA-256 do replay: {archive.data.recording.replaySha256}</p>
            {archive.data.recording.expiresAt && <p>Exibição pública até {new Date(archive.data.recording.expiresAt).toLocaleString('pt-BR')}.</p>}
            <p>A integridade consultada confere o replay e os segmentos de origem. O operador deve assistir e ouvir o arquivo antes de publicar.</p>
            <Button size="sm" variant="outline" disabled={archiveBusy} onClick={() => void api.getRecordingArchive(sessionId, true).then((result) => toast[result.integrity === 'valid' ? 'success' : 'error'](result.integrity === 'valid' ? 'Arquivo e segmentos íntegros.' : 'Integridade não confirmada.')).catch(() => undefined)}>Verificar integridade</Button>
          </>}
          {can('media.manage') && <div className="flex flex-wrap gap-2">
            <Button disabled={archiveBusy || transmission.status !== 'ended' || archive.data?.recording?.status === 'published'} onClick={() => void archiveCommand('build')}>{archive.data?.recording ? 'Preparar nova versão' : 'Preparar replay'}</Button>
            {archive.data?.recording && archive.data.recording.status !== 'published' && <Button variant="outline" disabled={archiveBusy} onClick={() => void archiveCommand('publish')}>Publicar replay</Button>}
            {archive.data?.recording?.status === 'published' && <Button variant="outline" disabled={archiveBusy} onClick={() => void archiveCommand('withdraw')}>Retirar replay</Button>}
          </div>}
        </CardContent>
      </Card>
    </div>
  )
}
