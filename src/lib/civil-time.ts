/** Converte o início de um dia civil no fuso da Câmara para UTC. */
export function civilDayStartUtc(day: string, timeZone: string): string {
  const target = Date.parse(`${day}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== day) {
    throw new Error('Data civil inválida.')
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  let instant = target
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = formatter.formatToParts(new Date(instant))
    const value = (kind: string) => Number(parts.find((part) => part.type === kind)?.value)
    const wall = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'))
    const next = instant + target - wall
    if (next === instant) break
    instant = next
  }
  return new Date(instant).toISOString()
}

/** Último instante do dia civil no fuso da Câmara. */
export function civilDayEndUtc(day: string, timeZone: string): string {
  civilDayStartUtc(day, timeZone)
  const nextDay = new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)
  return new Date(Date.parse(civilDayStartUtc(nextDay, timeZone)) - 1).toISOString()
}
