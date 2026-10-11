import { describe, expect, test } from 'bun:test'
import { nextTransmissionStatus, parseMediaMetrics } from '../src/lib/server/media-status'

describe('estado do acompanhamento local', () => {
  test('exige sinal antes de acompanhar e impede transições indevidas', () => {
    expect(nextTransmissionStatus('draft', 'prepare', false)).toBe('ready')
    expect(nextTransmissionStatus('ready', 'start_monitoring', false)).toBeNull()
    expect(nextTransmissionStatus('ready', 'start_monitoring', true)).toBe('monitoring')
    expect(nextTransmissionStatus('monitoring', 'stop_monitoring', false)).toBe('ended')
    expect(nextTransmissionStatus('ended', 'prepare', true)).toBeNull()
  })

  test('lê apenas o caminho exato e o estado ready nas métricas', () => {
    const metrics = [
      'paths{name="session-outra",state="ready"} 1',
      'paths{name="session-abc",state="notReady"} 1',
      'paths{name="session-abc",state="ready"} 1',
      'paths_inbound_bytes{name="session-abc",state="ready"} 1248',
    ].join('\n')
    expect(parseMediaMetrics(metrics, 'session-abc')).toEqual({ ready: true, inboundBytes: 1248 })
    expect(parseMediaMetrics(metrics, 'session-ab')).toEqual({ ready: false, inboundBytes: null })
  })
})
