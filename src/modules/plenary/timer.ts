'use client'

/**
 * Timer e alertas sonoros da mesa — tick local de 1s e beep WebAudio.
 */

import { useEffect, useState } from 'react'

/**
 * Relógio local com tick — retorna epoch ms atualizado a cada `intervalMs`.
 * `active = false` congela o valor (economia de render).
 */
export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, active])
  return now
}

let audioCtx: AudioContext | null = null

/**
 * Beep WebAudio (oscilador 880Hz, 150ms por padrão).
 * Falha silenciosamente quando o navegador bloqueia áudio sem interação.
 */
export function playBeep(freq = 880, durationMs = 150): void {
  if (typeof window === 'undefined') return
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    if (!audioCtx) audioCtx = new Ctor()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const t0 = audioCtx.currentTime
    const dur = durationMs / 1000
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start(t0)
    osc.stop(t0 + dur + 0.05)
  } catch {
    // áudio indisponível — o alerta visual permanece
  }
}
