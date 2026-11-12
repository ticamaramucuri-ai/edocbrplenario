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
  if (session.packageState === 'ready') {
    const button = element('button', 'summary-button', 'Ver pauta e documentos')
    button.type = 'button'
    button.setAttribute('aria-expanded', 'false')
    const panel = element('div', 'summary-panel')
    panel.hidden = true
    button.addEventListener('click', async () => {
      if (!panel.hidden) { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); return }
      button.disabled = true
      panel.replaceChildren(element('p', '', 'Conferindo resumo…'))
      panel.hidden = false
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}`, { cache: 'no-store' })
        if (!response.ok) throw new Error('Resumo indisponível')
        const summary = await response.json()
        panel.replaceChildren()
        panel.append(element('h3', '', `Pauta · revisão ${summary.revisionNumber}`))
        const agenda = element('ol')
        for (const item of summary.agenda) agenda.append(element('li', '', item.title))
        if (!summary.agenda.length) agenda.append(element('li', '', 'Nenhum item na pauta importada.'))
        panel.append(agenda, element('h3', '', 'Documentos conferidos'))
        const docs = element('ul')
        for (const doc of summary.documents) docs.append(element('li', '', `${doc.name} · ${doc.mimeType}`))
        if (!summary.documents.length) docs.append(element('li', '', 'Nenhum documento no pacote.'))
        panel.append(docs, element('p', 'summary-note', 'Leitura de metadados; arquivos e votação local ainda não disponíveis.'))
        button.setAttribute('aria-expanded', 'true')
      } catch {
        panel.replaceChildren(element('p', 'summary-error', 'Resumo indisponível. Atualize o estado e tente novamente.'))
        button.setAttribute('aria-expanded', 'false')
      } finally { button.disabled = false }
    })
    card.append(button, panel)
  }
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
