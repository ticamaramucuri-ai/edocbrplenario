'use client'

/**
 * Tick local do telão — relógio HH:MM:SS e timers por segundo
 * (snapshot + incremento local enquanto o discurso está em andamento).
 */

import { useEffect, useState } from 'react'

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function fmtClock(now: number): string {
  return new Date(now).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Contagem regressiva humana: "2d 4h", "3h 12m", "12m 30s", "agora". */
export function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'agora'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}min`
  if (m > 0) return `${m}min ${sec}s`
  return `${sec}s`
}

export function fmtDurationBig(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}
