import { expect, test } from 'bun:test'
import {
  ATRASO_INDISPONIVEL_MS,
  GATEWAY_PADRAO,
  ROTULO_TEMPO_REAL_INDISPONIVEL,
  ROTULO_TEMPO_REAL_INDISPONIVEL_CURTO,
  realtimeEndpoint,
  realtimeEndpointTolerante,
} from '@/lib/realtime-endpoint'

test('URL explícita vence o gateway', () => {
  expect(realtimeEndpoint({ NEXT_PUBLIC_REALTIME_URL: 'http://localhost:3003' })).toBe(
    'http://localhost:3003',
  )
})

test('ambiente vazio cai no gateway padrão', () => {
  expect(realtimeEndpoint({})).toBe(GATEWAY_PADRAO)
  expect(realtimeEndpoint({ NEXT_PUBLIC_REALTIME_URL: '' })).toBe(GATEWAY_PADRAO)
})

test('valor só com espaços é ignorado', () => {
  expect(realtimeEndpoint({ NEXT_PUBLIC_REALTIME_URL: '   ' })).toBe(GATEWAY_PADRAO)
  expect(realtimeEndpoint({ NEXT_PUBLIC_REALTIME_URL: ' http://localhost:3003 ' })).toBe(
    'http://localhost:3003',
  )
})

test('URL inválida lança erro nomeando a variável', () => {
  expect(() => realtimeEndpoint({ NEXT_PUBLIC_REALTIME_URL: 'localhost:3003' })).toThrow(
    /NEXT_PUBLIC_REALTIME_URL/,
  )
  expect(() => realtimeEndpoint({ NEXT_PUBLIC_REALTIME_URL: 'ftp://localhost:3003' })).toThrow(
    /NEXT_PUBLIC_REALTIME_URL/,
  )
})

test('gateway alternativo substitui o caminho padrão', () => {
  expect(realtimeEndpoint({ NEXT_PUBLIC_REALTIME_GATEWAY: '/?XTransformPort=4003' })).toBe(
    '/?XTransformPort=4003',
  )
  expect(() => realtimeEndpoint({ NEXT_PUBLIC_REALTIME_GATEWAY: 'gateway-interno' })).toThrow(
    /NEXT_PUBLIC_REALTIME_GATEWAY/,
  )
})

test('endereço tolerante nunca lança: valor inválido cai no gateway', () => {
  const avisos: string[] = []
  const anterior = console.error
  console.error = (...args: unknown[]) => { avisos.push(args.map(String).join(' ')) }
  try {
    expect(realtimeEndpointTolerante({ NEXT_PUBLIC_REALTIME_URL: 'localhost:3003' })).toBe(
      GATEWAY_PADRAO,
    )
    expect(realtimeEndpointTolerante({ NEXT_PUBLIC_REALTIME_GATEWAY: 'gateway-interno' })).toBe(
      GATEWAY_PADRAO,
    )
  } finally {
    console.error = anterior
  }
  expect(avisos.length).toBe(2)
  expect(avisos[0]).toMatch(/NEXT_PUBLIC_REALTIME_URL/)
})

test('endereço tolerante devolve o valor válido quando há', () => {
  expect(realtimeEndpointTolerante({ NEXT_PUBLIC_REALTIME_URL: 'http://localhost:3003' })).toBe(
    'http://localhost:3003',
  )
  expect(realtimeEndpointTolerante({})).toBe(GATEWAY_PADRAO)
})

test('o rótulo curto do selo cabe numa linha e a causa fica no rótulo longo', () => {
  expect(ROTULO_TEMPO_REAL_INDISPONIVEL_CURTO).toBe('Tempo real indisponível')
  expect(ROTULO_TEMPO_REAL_INDISPONIVEL_CURTO.length).toBeLessThan(26)
  expect(ROTULO_TEMPO_REAL_INDISPONIVEL).toContain(ROTULO_TEMPO_REAL_INDISPONIVEL_CURTO)
})

test('rótulo de indisponibilidade nomeia o gateway e a variável', () => {
  expect(ROTULO_TEMPO_REAL_INDISPONIVEL).toBe(
    'Tempo real indisponível — verifique o gateway ou NEXT_PUBLIC_REALTIME_URL',
  )
})

test('o limite de espera é de 15 segundos', () => {
  expect(ATRASO_INDISPONIVEL_MS).toBe(15_000)
})
