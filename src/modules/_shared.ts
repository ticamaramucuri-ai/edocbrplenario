/**
 * Helpers locais dos módulos 3-a (dashboard/sessions/parliamentarians/matters/
 * audit/reports/portal/settings). Não altera arquivos compartilhados do shell.
 */
'use client'

import { useEffect, useState } from 'react'

/** Valor com debounce (usado na busca textual de matérias/auditoria). */
export function useDebouncedValue<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

/** Dispara download de blob no navegador. */
export function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** Exporta linhas chave-valor como CSV (separador ";", BOM p/ Excel pt-BR). */
export function exportCsv(
  filename: string,
  rows: Array<Record<string, string | number | null | undefined>>
): void {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const lines = [headers.join(';'), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(';'))]
  downloadBlob(filename, `\uFEFF${lines.join('\r\n')}`, 'text/csv')
}

/** Formata código de verificação em grupos de 4 (DBE6-9A31-773D). */
export function formatVerificationCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .split(/(.{4})/)
    .filter(Boolean)
    .join('-')
}

/** Trunca hash mantendo início e fim (mono). */
export function shortHash(hash: string | null | undefined, size = 10): string {
  if (!hash) return '—'
  return hash.length <= size * 2 ? hash : `${hash.slice(0, size)}…${hash.slice(-4)}`
}

/** Rótulo de seção da pauta em caixa alta institucional. */
export const AGENDA_SECTION_LABEL: Record<string, string> = {
  expediente: 'Expediente',
  ordem_do_dia: 'Ordem do Dia',
  comunicacoes: 'Comunicações',
}
