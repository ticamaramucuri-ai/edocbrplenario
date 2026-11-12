const app = document.getElementById('app')
const status = document.getElementById('status')
const identity = document.getElementById('identity')
const refresh = document.getElementById('refresh')

function element(tag, className, value) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (value !== undefined) node.textContent = value
  return node
}

function sessionCard(session) {
  const card = element('section', 'session')
  const title = element('div')
  title.append(element('h2', '', `Sessão ${session.sessionId}`),
    element('p', 'sub', session.revisionNumber === null ? 'Sem revisão verificada' : `Revisão ${session.revisionNumber} · ${session.artifactCount} arquivos conferidos`))
  const labels = { ready: 'Pacote verificado', incomplete: 'Pacote incompleto', corrupt: 'Pacote corrompido' }
  card.append(title, element('span', `state ${session.packageState}`, labels[session.packageState] || 'Estado desconhecido'))
  const detail = element('div', 'detail')
  detail.append(element('span', '', `Dispositivo: ${identity.dataset.deviceId || '—'}`),
    element('span', '', `Abertura: bloqueada`))
  card.append(detail)
  const blockers = element('div', 'blockers')
  blockers.append(element('strong', '', 'Abertura bloqueada'))
  const list = element('ul')
  for (const blocker of session.blockers) list.append(element('li', '', blocker))
  blockers.append(list)
  card.append(blockers)
  return card
}

function render(view) {
  app.replaceChildren()
  identity.dataset.deviceId = view.deviceId
  identity.textContent = `${view.tenantId} · ${view.deviceId}`
  status.className = 'status'
  if (view.sessions.length === 0) {
    status.replaceChildren(element('span', '', 'Nenhuma sessão importada'))
    const empty = element('div', 'empty')
    empty.append(element('strong', '', 'Aguardando pacote de sessão'),
      element('span', '', 'Prepare uma sessão na web e sincronize este servidor.'))
    app.append(empty)
    return
  }
  const ready = view.sessions.filter((session) => session.packageState === 'ready').length
  status.replaceChildren(element('span', '', `${view.sessions.length} sessão(ões) importada(s) · ${ready} pacote(s) verificado(s)`),
    element('small', '', 'Abertura bloqueada: autoridade local de sessão ainda não habilitada.'))
  for (const session of view.sessions) app.append(sessionCard(session))
}

async function loadStatus() {
  refresh.disabled = true
  try {
    const response = await fetch('/api/status', { cache: 'no-store' })
    if (!response.ok) throw new Error('Inventário indisponível')
    const view = await response.json()
    if (view.version !== 1 || view.operation !== 'read_only' || !Array.isArray(view.sessions)) throw new Error('Inventário indisponível')
    render(view)
  } catch {
    app.replaceChildren()
    identity.textContent = 'Sem confirmação recente'
    identity.className = 'identity identity-error'
    status.className = 'status error'
    status.replaceChildren(element('span', '', 'Inventário indisponível'),
      element('small', '', 'Confira o serviço local e atualize a página. Nenhuma sessão pode ser aberta.'))
  } finally { refresh.disabled = false }
}

refresh.addEventListener('click', loadStatus)
void loadStatus()
setInterval(loadStatus, 15_000)
