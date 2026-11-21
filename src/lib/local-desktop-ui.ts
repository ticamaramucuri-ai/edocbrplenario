/**
 * Interface HTML/SPA embutida do edocBR Plenário Desktop (6 telas operacionais).
 * Servida diretamente pelo processo local na LAN sem dependência de internet.
 */
export function renderDesktopAppHtml(meta: {
  tenantId: string
  deviceId: string
  baseUrl: string
  lanPort: number
}): string {
  const esc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>edocBR Plenário Desktop — Servidor Local</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; line-height: 1.45; height: 100vh; display: flex; flex-direction: column; }
    .titlebar { height: 46px; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; font-size: 13px; flex-shrink: 0; }
    .titlebar-left { display: flex; align-items: center; gap: 10px; font-weight: 600; }
    .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; background: #22c55e; }
    .pill { padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
    .pill-green { background: #dcfce7; color: #166534; }
    .pill-amber { background: #fef3c7; color: #92400e; }
    .pill-blue { background: #dbeafe; color: #1e40af; }
    .pill-red { background: #fee2e2; color: #991b1b; }
    .pill-slate { background: #e2e8f0; color: #334155; }
    .workspace { display: flex; flex: 1; min-height: 0; }
    .sidebar { width: 245px; background: #fff; border-right: 1px solid #e2e8f0; padding: 14px 10px; display: flex; flex-direction: column; justify-content: space-between; flex-shrink: 0; }
    .nav-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; padding: 8px 10px 4px; }
    .nav-btn { width: 100%; text-align: left; background: none; border: none; padding: 9px 12px; border-radius: 8px; font-size: 13px; font-weight: 500; color: #334155; cursor: pointer; display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
    .nav-btn:hover { background: #f1f5f9; }
    .nav-btn.active { background: #eff6ff; color: #1d4ed8; font-weight: 600; }
    .sidebar-footer { border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 11px; color: #475569; display: flex; flex-direction: column; gap: 4px; }
    .main { flex: 1; padding: 22px 26px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
    .screen-pane { display: none; flex-direction: column; gap: 16px; }
    .screen-pane.active { display: flex; }
    .page-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .page-title { font-size: 20px; font-weight: 700; }
    .page-sub { font-size: 13px; color: #64748b; }
    .btn { padding: 8px 14px; border-radius: 7px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; background: #fff; color: #0f172a; cursor: pointer; }
    .btn:hover { background: #f1f5f9; }
    .btn-primary { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
    .btn-primary:hover { background: #1e40af; }
    .btn-success { background: #15803d; color: #fff; border-color: #15803d; }
    .btn-amber { background: #b45309; color: #fff; border-color: #b45309; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; }
    .card-title { font-size: 14px; font-weight: 700; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; }
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
    .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .kv { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid #f1f5f9; font-size: 12.5px; }
    .kv:last-child { border-bottom: none; }
    .kv-k { color: #64748b; }
    .kv-v { font-weight: 600; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th { text-align: left; padding: 8px 10px; background: #f1f5f9; color: #475569; font-size: 11px; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; }
    td { padding: 9px 10px; border-bottom: 1px solid #f1f5f9; }
    .input { padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12.5px; width: 100%; }
    .toast { position: fixed; bottom: 16px; right: 16px; background: #0f172a; color: #fff; padding: 10px 16px; border-radius: 8px; font-size: 12.5px; display: none; z-index: 50; }
  </style>
</head>
<body>
  <header class="titlebar">
    <div class="titlebar-left">
      <span class="dot" id="ws-dot"></span>
      <span>edocBR Plenário Desktop — Servidor LAN</span>
      <span class="pill pill-green" id="top-status">Ativo</span>
    </div>
    <div style="display:flex;align-items:center;gap:10px;">
      <span class="mono" style="color:#cbd5e1;">${esc(meta.tenantId)}</span>
      <span class="pill pill-slate" id="ws-label">WebSocket: conectando…</span>
    </div>
  </header>

  <div class="workspace">
    <aside class="sidebar">
      <div>
        <div class="nav-label">Servidor Local</div>
        <button class="nav-btn active" data-screen="1">1. Pareamento &amp; Cofre</button>
        <button class="nav-btn" data-screen="2">2. Central de Sessões <span class="pill pill-blue" id="nav-sess-count">0</span></button>
        <button class="nav-btn" data-screen="3">3. Pré-Voo &amp; Autoridade</button>
        <div class="nav-label">Operação LAN</div>
        <button class="nav-btn" data-screen="4">4. Mesa Local (Plenário)</button>
        <button class="nav-btn" data-screen="5">5. Rede LAN &amp; Telões <span class="pill pill-slate" id="nav-lan-count">0</span></button>
        <button class="nav-btn" data-screen="6">6. Diário &amp; Reconciliação</button>
      </div>
      <div class="sidebar-footer">
        <div><strong>Device:</strong> <span class="mono">${esc(meta.deviceId.slice(0, 14))}</span></div>
        <div><strong>Porta LAN:</strong> ${meta.lanPort}</div>
        <div><strong>SaaS:</strong> ${esc(meta.baseUrl)}</div>
      </div>
    </aside>

    <main class="main">
      <!-- TELA 1 -->
      <section class="screen-pane active" id="pane-1">
        <div class="page-head">
          <div><h1 class="page-title">Pareamento, Identidade e Cofre Local</h1><p class="page-sub">Identidade criptográfica Ed25519 do servidor designado pela Câmara.</p></div>
          <button class="btn btn-primary" onclick="refreshAll()">Atualizar Estado</button>
        </div>
        <div class="grid-2">
          <div class="card">
            <div class="card-title">Identidade do Equipamento <span class="pill pill-green">Ativo</span></div>
            <div class="kv"><span class="kv-k">Tenant / Câmara</span><span class="kv-v">${esc(meta.tenantId)}</span></div>
            <div class="kv"><span class="kv-k">ID do Dispositivo</span><span class="kv-v mono">${esc(meta.deviceId)}</span></div>
            <div class="kv"><span class="kv-k">Endpoint SaaS</span><span class="kv-v mono">${esc(meta.baseUrl)}</span></div>
            <div class="kv"><span class="kv-k">Porta HTTP/WS LAN</span><span class="kv-v">${meta.lanPort}</span></div>
          </div>
          <div class="card">
            <div class="card-title">Serviço Local <span class="pill pill-blue">Operacional</span></div>
            <div class="kv"><span class="kv-k">Diário Criptográfico</span><span class="kv-v" id="s1-journal">Verificando…</span></div>
            <div class="kv"><span class="kv-k">Dispositivos na LAN</span><span class="kv-v" id="s1-lan">0</span></div>
            <div class="kv"><span class="kv-k">Sessões Preparadas</span><span class="kv-v" id="s1-sessions">0</span></div>
          </div>
        </div>
      </section>

      <!-- TELA 2 -->
      <section class="screen-pane" id="pane-2">
        <div class="page-head">
          <div><h1 class="page-title">Central de Sessões Importadas</h1><p class="page-sub">Pacotes verificados por assinatura e SHA-256 em armazenamento local.</p></div>
          <div style="display:flex;gap:8px;">
            <button class="btn" onclick="syncPackages()">Sincronizar Pacotes Agora</button>
            <button class="btn btn-primary" onclick="refreshAll()">Recarregar Pacotes</button>
          </div>
        </div>
        <div class="card">
          <table>
            <thead><tr><th>Sessão</th><th>Revisão</th><th>Artefatos</th><th>Estado</th><th>Ação</th></tr></thead>
            <tbody id="sessions-tbody"><tr><td colspan="5">Carregando…</td></tr></tbody>
          </table>
        </div>
      </section>

      <!-- TELA 3 -->
      <section class="screen-pane" id="pane-3">
        <div class="page-head">
          <div><h1 class="page-title">Pré-Voo e Concessão de Autoridade</h1><p class="page-sub">Conferência de integridade e bloqueios antes da operação na rede interna.</p></div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-success" onclick="grantAuthority()">Assumir Autoridade Local</button>
            <button class="btn btn-primary" onclick="loadPreflight()">Revalidar Pré-Voo</button>
          </div>
        </div>
        <div class="card" id="preflight-box">Selecione uma sessão na Central de Sessões para conferir o Pré-Voo.</div>
      </section>

      <!-- TELA 4 -->
      <section class="screen-pane" id="pane-4">
        <div class="page-head">
          <div><h1 class="page-title">Mesa de Condução Local (LAN)</h1><p class="page-sub">Execução local no diário assinado Ed25519 com broadcast instantâneo na rede interna.</p></div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-amber" onclick="toggleFreeze()">Congelar / Liberar Telão</button>
          </div>
        </div>
        <div class="grid-2">
          <div class="card">
            <div class="card-title">Snapshot Ao Vivo <span class="pill pill-slate" id="mesa-freeze-badge">Telão Ativo</span></div>
            <div class="kv"><span class="kv-k">Sessão Ativa</span><span class="kv-v mono" id="mesa-session">—</span></div>
            <div class="kv"><span class="kv-k">Presentes Registrados</span><span class="kv-v" id="mesa-present">0</span></div>
            <div class="kv"><span class="kv-k">Votação Atual</span><span class="kv-v" id="mesa-voting">Nenhuma</span></div>
            <div class="kv"><span class="kv-k">Placar Local</span><span class="kv-v" id="mesa-tally">Sim: 0 · Não: 0 · Abst.: 0</span></div>
          </div>
          <div class="card">
            <div class="card-title">Comandos Rápidos (Diário Local)</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              <input class="input" id="cmd-parl" placeholder="ID do Parlamentar (ex: parl_1)" />
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn btn-success" onclick="sendAttendance('check_in')">Registrar Presença</button>
                <button class="btn" onclick="openLocalVoting()">Abrir Votação Teste</button>
                <button class="btn btn-primary" onclick="castLocalVote('sim')">Votar SIM</button>
                <button class="btn" onclick="castLocalVote('nao')">Votar NÃO</button>
                <button class="btn btn-amber" onclick="closeLocalVoting()">Encerrar Votação</button>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">
                <button class="btn" onclick="sendSpeech('start')">Iniciar Tribuna</button>
                <button class="btn" onclick="sendSpeech('aparte')">Conceder Aparte</button>
                <button class="btn" onclick="sendSpeech('stop')">Encerrar Tribuna</button>
                <button class="btn" onclick="sendAgenda('select')">Destacar Pauta</button>
                <button class="btn" onclick="sendAgenda('vista')">Pedido de Vista</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- TELA 5 -->
      <section class="screen-pane" id="pane-5">
        <div class="page-head">
          <div><h1 class="page-title">Monitor de Rede LAN e Telões</h1><p class="page-sub">Dispositivos (tablets e telões) conectados ao WebSocket local.</p></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <a class="btn" href="/telao" target="_blank">Abrir Telão LAN</a>
            <a class="btn" href="/vereador" target="_blank">Abrir Terminal Vereador</a>
            <button class="btn btn-primary" onclick="broadcastSnapshotNow()">Reenviar Snapshot</button>
            <button class="btn btn-amber" onclick="toggleFreeze()">Congelar / Liberar Telões</button>
          </div>
        </div>
        <div class="card" style="margin-bottom:4px;">
          <div class="card-title">Endereços na Rede Interna (LAN) para Tablets e Telões</div>
          <div id="lan-urls" class="mono" style="font-size:12px;color:#334155;">Carregando interfaces LAN…</div>
        </div>
        <div class="card">
          <table>
            <thead><tr><th>ID Cliente</th><th>Tipo</th><th>Conectado em</th><th>Ação</th></tr></thead>
            <tbody id="lan-tbody"><tr><td colspan="4">Nenhum dispositivo conectado no momento.</td></tr></tbody>
          </table>
        </div>
      </section>

      <!-- TELA 6 -->
      <section class="screen-pane" id="pane-6">
        <div class="page-head">
          <div><h1 class="page-title">Diário Criptográfico e Reconciliação</h1><p class="page-sub">Eventos assinados localmente e envio ordenado para o SaaS.</p></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn" onclick="exportBackup()">Exportar Backup Local</button>
            <button class="btn btn-amber" onclick="releaseAuthority()">Devolver Autoridade para Web</button>
            <button class="btn btn-primary" onclick="reconcileNow()">Reconciliar com SaaS</button>
          </div>
        </div>
        <div class="grid-4">
          <div class="card"><div style="font-size:11px;color:#64748b;">Total no Diário</div><div style="font-size:22px;font-weight:800;" id="j-total">0</div></div>
          <div class="card"><div style="font-size:11px;color:#64748b;">Último Sequencial</div><div style="font-size:22px;font-weight:800;" id="j-seq">0</div></div>
          <div class="card"><div style="font-size:11px;color:#64748b;">ACK SaaS</div><div style="font-size:22px;font-weight:800;color:#15803d;" id="j-acked">0</div></div>
          <div class="card"><div style="font-size:11px;color:#64748b;">Pendentes</div><div style="font-size:22px;font-weight:800;color:#b45309;" id="j-pending">0</div></div>
        </div>
        <div class="card">
          <table>
            <thead><tr><th>Seq</th><th>Hora</th><th>Evento</th><th>Hash Cadeia</th><th>Status</th></tr></thead>
            <tbody id="journal-tbody"><tr><td colspan="5">Nenhum evento no diário.</td></tr></tbody>
          </table>
        </div>
      </section>
    </main>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    let activeSessionId = null;
    let activeVotingId = null;
    let displayFrozen = false;

    function showToast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.style.display = 'block';
      setTimeout(() => { el.style.display = 'none'; }, 3500);
    }

    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.screen-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('pane-' + btn.dataset.screen).classList.add('active');
      });
    });

    async function api(path, opts) {
      const r = await fetch(path, opts);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Erro na API local');
      return data;
    }

    async function refreshAll() {
      try {
        const st = await api('/api/local/status');
        document.getElementById('nav-sess-count').textContent = st.sessions.length;
        document.getElementById('s1-sessions').textContent = st.sessions.length;
        document.getElementById('s1-journal').textContent = st.journalVerified ? 'Íntegro (Ed25519 OK)' : 'Erro';
        document.getElementById('s1-lan').textContent = st.lanClients.length;
        document.getElementById('nav-lan-count').textContent = st.lanClients.length;

        const tbody = document.getElementById('sessions-tbody');
        tbody.innerHTML = st.sessions.length === 0 ? '<tr><td colspan="5">Nenhuma sessão importada.</td></tr>' : st.sessions.map(s => {
          const rev = s.prepared ? 'Rev. ' + s.prepared.revisionNumber : '—';
          const badge = s.state === 'ready' ? '<span class="pill pill-green">Pronto</span>' : '<span class="pill pill-amber">' + s.state + '</span>';
          return '<tr><td class="mono">' + s.sessionId + '</td><td>' + rev + '</td><td>' + (s.artifactCount ?? 0) + ' arq.</td><td>' + badge + '</td><td><button class="btn btn-primary" onclick="selectSession(\\'' + s.sessionId + '\\')">Selecionar</button></td></tr>';
        }).join('');

        const lanBody = document.getElementById('lan-tbody');
        lanBody.innerHTML = st.lanClients.length === 0 ? '<tr><td colspan="4">Nenhum dispositivo conectado.</td></tr>' : st.lanClients.map(c =>
          '<tr><td class="mono">' + c.id + '</td><td>' + c.kind + '</td><td>' + c.connectedAt + '</td><td><button class="btn" onclick="disconnectClient(\\'' + c.id + '\\')">Desconectar</button></td></tr>'
        ).join('');

        const lanUrlsEl = document.getElementById('lan-urls');
        if (lanUrlsEl) {
          const bases = (st.lanAddresses && st.lanAddresses.length) ? st.lanAddresses : [location.origin];
          lanUrlsEl.innerHTML = bases.map(b =>
            '<div>Telão: <strong>' + b + '/telao</strong> · Vereador: <strong>' + b + '/vereador</strong></div>'
          ).join('');
        }

        if (!activeSessionId && st.sessions[0]) activeSessionId = st.sessions[0].sessionId;
        if (activeSessionId) {
          await Promise.all([loadPreflight(), loadSnapshot(), loadJournal()]);
        }
      } catch (e) { showToast(e.message); }
    }

    function selectSession(id) {
      activeSessionId = id;
      refreshAll();
      showToast('Sessão selecionada: ' + id);
    }

    async function loadPreflight() {
      if (!activeSessionId) return;
      const pf = await api('/api/local/sessions/' + encodeURIComponent(activeSessionId) + '/preflight');
      document.getElementById('preflight-box').innerHTML =
        '<div class="kv"><span class="kv-k">Sessão</span><span class="kv-v mono">' + pf.sessionId + '</span></div>' +
        '<div class="kv"><span class="kv-k">Estado do Pacote</span><span class="kv-v">' + pf.packageState + '</span></div>' +
        '<div class="kv"><span class="kv-k">Diário Verificado</span><span class="kv-v">' + (pf.journalVerified ? 'Sim' : 'Não') + '</span></div>' +
        '<div class="kv"><span class="kv-k">Espaço em Disco</span><span class="kv-v">' + (pf.disk && pf.disk.ok ? Math.round(pf.disk.freeBytes / (1024 * 1024)) + ' MB livres' : 'Insuficiente') + '</span></div>' +
        '<div class="kv"><span class="kv-k">Eventos Gravados</span><span class="kv-v">' + pf.journalCount + '</span></div>';
    }

    async function loadSnapshot() {
      if (!activeSessionId) return;
      const snap = await api('/api/local/sessions/' + encodeURIComponent(activeSessionId) + '/snapshot');
      document.getElementById('mesa-session').textContent = activeSessionId;
      document.getElementById('mesa-present').textContent = snap.presentParliamentarianIds.length;
      displayFrozen = snap.displayFrozen;
      document.getElementById('mesa-freeze-badge').textContent = displayFrozen ? 'Telão Congelado' : 'Telão Ativo';
      if (snap.activeVoting) {
        activeVotingId = snap.activeVoting.id;
        document.getElementById('mesa-voting').textContent = snap.activeVoting.question + ' [' + snap.activeVoting.status + ']';
        document.getElementById('mesa-tally').textContent = 'Sim: ' + snap.activeVoting.counts.sim + ' · Não: ' + snap.activeVoting.counts.nao + ' · Abst.: ' + snap.activeVoting.counts.abstencao;
      }
    }

    async function loadJournal() {
      if (!activeSessionId) return;
      const j = await api('/api/local/sessions/' + encodeURIComponent(activeSessionId) + '/journal');
      const acked = j.lastAckedSeq || 0;
      document.getElementById('j-total').textContent = j.events.length;
      document.getElementById('j-seq').textContent = j.events.length ? j.events[j.events.length - 1].sequence : 0;
      document.getElementById('j-acked').textContent = acked;
      document.getElementById('j-pending').textContent = j.pendingCount ?? 0;
      const tbody = document.getElementById('journal-tbody');
      tbody.innerHTML = j.events.length === 0 ? '<tr><td colspan="5">Nenhum evento no diário.</td></tr>' : [...j.events].reverse().map(ev => {
        const badge = ev.sequence <= acked ? '<span class="pill pill-green">ACK SaaS</span>' : '<span class="pill pill-amber">Pendente</span>';
        return '<tr><td class="mono">#' + ev.sequence + '</td><td>' + ev.createdAt.slice(11, 19) + '</td><td>' + ev.eventType + '</td><td class="mono">' + ev.eventHash.slice(0, 14) + '…</td><td>' + badge + '</td></tr>';
      }).join('');
    }

    async function sendAttendance(kind) {
      if (!activeSessionId) return showToast('Selecione uma sessão');
      const pid = document.getElementById('cmd-parl').value.trim() || 'parl_1';
      await api('/api/local/sessions/' + encodeURIComponent(activeSessionId) + '/attendance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parliamentarianId: pid, kind, commandId: crypto.randomUUID() })
      });
      showToast('Presença gravada localmente');
      refreshAll();
    }

    async function openLocalVoting() {
      if (!activeSessionId) return showToast('Selecione uma sessão');
      const res = await api('/api/local/sessions/' + encodeURIComponent(activeSessionId) + '/votings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'Deliberação em Plenário Local', mode: 'nominal', commandId: crypto.randomUUID() })
      });
      activeVotingId = res.votingId;
      showToast('Votação aberta localmente');
      refreshAll();
    }

    async function castLocalVote(value) {
      if (!activeSessionId || !activeVotingId) return showToast('Abra uma votação primeiro');
      const pid = document.getElementById('cmd-parl').value.trim() || 'parl_1';
      await api('/api/local/sessions/' + encodeURIComponent(activeSessionId) + '/votes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ votingId: activeVotingId, parliamentarianId: pid, value, commandId: crypto.randomUUID() })
      });
      showToast('Voto ' + value.toUpperCase() + ' gravado no diário local');
      refreshAll();
    }

    async function closeLocalVoting() {
      if (!activeSessionId || !activeVotingId) return showToast('Nenhuma votação ativa');
      await api('/api/local/sessions/' + encodeURIComponent(activeSessionId) + '/votings/close', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ votingId: activeVotingId, commandId: crypto.randomUUID() })
      });
      showToast('Votação encerrada localmente');
      refreshAll();
    }

    async function toggleFreeze() {
      if (!activeSessionId) return showToast('Selecione uma sessão');
      await api('/api/local/sessions/' + encodeURIComponent(activeSessionId) + '/display/freeze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frozen: !displayFrozen, commandId: crypto.randomUUID() })
      });
      showToast(!displayFrozen ? 'Telão congelado' : 'Telão liberado');
      refreshAll();
    }

    async function reconcileNow() {
      if (!activeSessionId) return showToast('Selecione uma sessão');
      try {
        const res = await api('/api/local/sessions/' + encodeURIComponent(activeSessionId) + '/reconcile', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ epoch: 1 })
        });
        showToast('Reconciliados: ' + res.appliedCount + ' aplicado(s), ' + res.deduplicatedCount + ' deduplicado(s)');
      } catch (e) { showToast(e.message); }
    }

    async function syncPackages() {
      try {
        await api('/api/local/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        showToast('Pacotes sincronizados com sucesso');
        refreshAll();
      } catch (e) { showToast(e.message); }
    }

    async function grantAuthority() {
      if (!activeSessionId) return showToast('Selecione uma sessão');
      try {
        await api('/api/local/sessions/' + encodeURIComponent(activeSessionId) + '/authority/grant', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
        });
        showToast('Autoridade local assumida');
        refreshAll();
      } catch (e) { showToast(e.message); }
    }

    async function releaseAuthority() {
      if (!activeSessionId) return showToast('Selecione uma sessão');
      try {
        await api('/api/local/sessions/' + encodeURIComponent(activeSessionId) + '/authority/release', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
        });
        showToast('Autoridade devolvida para a Web');
        refreshAll();
      } catch (e) { showToast(e.message); }
    }

    async function sendSpeech(action) {
      if (!activeSessionId) return showToast('Selecione uma sessão');
      const pid = document.getElementById('cmd-parl').value.trim() || 'parl_1';
      await api('/api/local/sessions/' + encodeURIComponent(activeSessionId) + '/speeches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, parliamentarianId: pid, commandId: crypto.randomUUID() })
      });
      showToast('Tribuna atualizada localmente');
      refreshAll();
    }

    async function sendAgenda(action) {
      if (!activeSessionId) return showToast('Selecione uma sessão');
      const pid = document.getElementById('cmd-parl').value.trim() || 'parl_1';
      await api('/api/local/sessions/' + encodeURIComponent(activeSessionId) + '/agenda', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, itemTitle: 'Item de Pauta Local', parliamentarianId: pid, commandId: crypto.randomUUID() })
      });
      showToast('Pauta atualizada localmente');
      refreshAll();
    }

    async function broadcastSnapshotNow() {
      if (!activeSessionId) return showToast('Selecione uma sessão');
      const res = await api('/api/local/sessions/' + encodeURIComponent(activeSessionId) + '/broadcast-snapshot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      showToast('Snapshot reenviado para ' + res.clientsNotified + ' cliente(s)');
    }

    async function disconnectClient(clientId) {
      await api('/api/local/clients/' + encodeURIComponent(clientId) + '/disconnect', { method: 'POST' });
      showToast('Cliente desconectado');
      refreshAll();
    }

    function exportBackup() {
      if (!activeSessionId) return showToast('Selecione uma sessão');
      window.open('/api/local/sessions/' + encodeURIComponent(activeSessionId) + '/backup', '_blank');
    }

    function connectWs() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(proto + '//' + location.host + '/ws?kind=desktop');
      ws.onopen = () => { document.getElementById('ws-label').textContent = 'WebSocket: conectado'; };
      ws.onclose = () => { document.getElementById('ws-label').textContent = 'WebSocket: reconectando…'; setTimeout(connectWs, 3000); };
      ws.onmessage = () => { refreshAll(); };
    }

    refreshAll();
    connectWs();
  </script>
</body>
</html>`
}

