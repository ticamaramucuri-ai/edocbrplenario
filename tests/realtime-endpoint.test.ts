import { expect, test } from 'bun:test'
import {
  ATRASO_INDISPONIVEL_MS,
  GATEWAY_PADRAO,
  ROTULO_TEMPO_REAL_INDISPONIVEL,
  realtimeEndpoint,
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

test('rótulo de indisponibilidade nomeia o gateway e a variável', () => {
  expect(ROTULO_TEMPO_REAL_INDISPONIVEL).toBe(
    'Tempo real indisponível — verifique o gateway ou NEXT_PUBLIC_REALTIME_URL',
  )
})

test('o limite de espera é de 15 segundos', () => {
  expect(ATRASO_INDISPONIVEL_MS).toBe(15_000)
})
