/** Guarda somente o UUID da tentativa de auto check-in, isolado por ator e sessão. */
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type Pending = { sessionId: string; commandId: string }

const key = (actorId: string) => `edocbr:pending-checkin:${actorId}`

export function pendingCheckInCommand(store: Store, actorId: string, sessionId: string): string {
  const storageKey = key(actorId)
  try {
    const pending = JSON.parse(store.getItem(storageKey) || 'null') as Pending | null
    if (pending?.sessionId === sessionId && typeof pending.commandId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pending.commandId)) {
      return pending.commandId
    }
  } catch { /* registro incompleto: substitui por uma tentativa nova */ }
  const commandId = crypto.randomUUID()
  try { store.setItem(storageKey, JSON.stringify({ sessionId, commandId } satisfies Pending)) }
  catch { /* bloqueio de armazenamento local não deve impedir a tentativa */ }
  return commandId
}

export function clearPendingCheckIn(store: Store, actorId: string, sessionId: string): void {
  const storageKey = key(actorId)
  try {
    const pending = JSON.parse(store.getItem(storageKey) || 'null') as Pending | null
    if (pending?.sessionId === sessionId) store.removeItem(storageKey)
  } catch {
    try { store.removeItem(storageKey) } catch { /* armazenamento indisponível */ }
  }
}
