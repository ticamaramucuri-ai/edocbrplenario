/**
 * Formatação pt-BR e utilidades de exibição.
 */
import type { MatterType } from './contracts'
import { MATTER_TYPE_SHORT, MATTER_TYPE_LABEL } from './contracts'

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter((p) => p.length > 2 || ['de', 'do', 'da'].indexOf(p) === -1)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export function matterLabel(type: string, number: number, year: number): string {
  const short = MATTER_TYPE_SHORT[type as MatterType] ?? type.toUpperCase()
  return `${short} ${number}/${year}`
}

export function matterFullLabel(type: string, number: number, year: number): string {
  return `${MATTER_TYPE_LABEL[type as MatterType] ?? type} nº ${number}/${year}`
}

export function plural(n: number, singular: string, pluralWord?: string): string {
  return `${n} ${n === 1 ? singular : (pluralWord ?? `${singular}s`)}`
}
