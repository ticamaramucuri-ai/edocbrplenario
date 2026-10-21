/**
 * Telões sintéticos: um cliente socket.io por nó de tempo real, na sala pública.
 *
 * Observa o que o portal e o telão realmente recebem durante a carga e mede o
 * atraso de cada evento (`occurredAt` do envelope até a chegada no cliente).
 * Imprime NDJSON em stdout para o orquestrador ler incrementalmente:
 *
 *   {"tipo":"inscrito","no":0}
 *   {"tipo":"evento","no":0,"eventId":"…","eventType":"vote.recorded","atrasoMs":12.3}
 *   {"tipo":"queda","no":1}            (janela de falha induzida)
 *   {"tipo":"fim","no":0,"recebidos":57}
 *
 * Uso: bun scripts/staging-display-observers.ts --tenant <cuid> --urls <u1,u2>
 *        --segundos 90 [--queda-no 1 --queda-apos 10 --queda-por 8]
 */
import { io, type Socket } from 'socket.io-client'

function opcao(nome: string, padrao?: string): string | undefined {
  const indice = process.argv.indexOf(`--${nome}`)
  return indice >= 0 ? process.argv[indice + 1] : padrao
}

const tenantId = opcao('tenant')
const urls = (opcao('urls') ?? '').split(',').filter(Boolean)
const segundos = Number(opcao('segundos', '90'))
const quedaNo = Number(opcao('queda-no', '-1'))
const quedaApos = Number(opcao('queda-apos', '0'))
const quedaPor = Number(opcao('queda-por', '0'))

if (!tenantId || urls.length === 0) {
  throw new Error('Informe --tenant <cuid> e --urls <url1,url2>.')
}

function linha(dados: Record<string, unknown>): void {
  console.log(JSON.stringify(dados))
}

interface Envelope {
  eventId?: string
  eventType?: string
  occurredAt?: string
}

const recebidos = urls.map(() => 0)
const sockets: Socket[] = []

urls.forEach((url, indice) => {
  const socket = io(url, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 300,
    auth: { tenantId, scope: 'public' },
  })
  sockets.push(socket)

  socket.on('subscribed', (dados: { scope?: string }) => {
    if (dados?.scope === 'public') linha({ tipo: 'inscrito', no: indice })
  })
  socket.on('subscribe_error', (dados: unknown) => {
    linha({ tipo: 'erro', no: indice, detalhe: String(dados).slice(0, 200) })
  })
  socket.on('connect_error', (erro) => {
    linha({ tipo: 'erro', no: indice, detalhe: erro.message.slice(0, 200) })
  })

  socket.onAny((eventType: string, evento: Envelope) => {
    if (!evento || typeof evento !== 'object' || !evento.eventId) return
    const chegada = Date.now()
    const emitido = evento.occurredAt ? Date.parse(evento.occurredAt) : NaN
    recebidos[indice] += 1
    linha({
      tipo: 'evento',
      no: indice,
      eventId: evento.eventId,
      eventType: evento.eventType ?? eventType,
      atrasoMs: Number.isFinite(emitido) ? Math.max(0, chegada - emitido) : null,
    })
  })
})

// Janela de queda induzida: o nó escolhido sai da sala e volta. Os eventos
// emitidos no intervalo não chegam a ele — é a condição que o orquestrador
// precisa acusar como evento perdido.
if (quedaNo >= 0 && quedaNo < sockets.length && quedaPor > 0) {
  setTimeout(() => {
    linha({ tipo: 'queda', no: quedaNo })
    sockets[quedaNo].disconnect()
    setTimeout(() => {
      linha({ tipo: 'retorno', no: quedaNo })
      sockets[quedaNo].connect()
    }, quedaPor * 1000)
  }, quedaApos * 1000)
}

setTimeout(() => {
  for (const [indice, socket] of sockets.entries()) {
    linha({ tipo: 'fim', no: indice, recebidos: recebidos[indice] })
    socket.disconnect()
  }
  process.exit(0)
}, segundos * 1000)
