/**
 * Interfaces HTML leves para clientes LAN conectados ao servidor desktop:
 * - GET /telao: Painel de plenário em tempo real (WebSocket /ws?kind=telao)
 * - GET /vereador: Terminal de presença e votação do parlamentar (WebSocket /ws?kind=vereador)
 */

export function renderLanTelaoHtml(meta: { tenantId: string; deviceId: string; sessionId?: string }): string {
  const initialSession = meta.sessionId ?? ''
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Telão LAN — edocBR Plenário</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #020617; color: #f8fafc; min-height: 100vh; display: flex; flex-direction: column; padding: 28px 36px; gap: 22px; }
    .top { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1e293b; padding-bottom: 16px; }
    .brand { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
    .badge { padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; background: #0f172a; border: 1px solid #334155; color: #38bdf8; }
    .badge.frozen { background: #451a03; border-color: #d97706; color: #fde68a; }
    .grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 22px; flex: 1; }
    .panel { background: #0f172a; border: 1px solid #1e293b; border-radius: 14px; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
    .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; font-weight: 700; }
    .question { font-size: 28px; font-weight: 700; line-height: 1.25; }
    .counts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: auto; }
    .count-box { border-radius: 12px; padding: 20px; text-align: center; }
    .sim { background: #052e16; border: 1px solid #16a34a; }
    .nao { background: #450a0a; border: 1px solid #dc2626; }
    .abs { background: #422006; border: 1px solid #d97706; }
    .num { font-size: 54px; font-weight: 800; line-height: 1; }
    .lbl { font-size: 14px; font-weight: 700; margin-top: 8px; opacity: 0.9; }
    .big-stat { font-size: 46px; font-weight: 800; color: #38bdf8; }
    .box { background: #020617; border: 1px solid #1e293b; border-radius: 10px; padding: 14px 16px; }
    .footer { display: flex; justify-content: space-between; font-size: 12px; color: #64748b; border-top: 1px solid #1e293b; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="top">
    <div>
      <div class="brand">edocBR Plenário — Telão LAN</div>
      <div style="font-size:13px;color:#94a3b8;margin-top:4px;">Câmara: ${escapeHtml(meta.tenantId)} · Sessão: <span id="t-session">${escapeHtml(initialSession || 'Aguardando…')}</span></div>
    </div>
    <div style="display:flex;gap:10px;align-items:center;">
      <span id="t-frozen" class="badge" style="display:none;">TELÃO CONGELADO</span>
      <span id="t-ws" class="badge">Conectando LAN…</span>
    </div>
  </div>
  <div class="grid">
    <div class="panel">
      <div class="label">Deliberação em Pauta</div>
      <div id="t-agenda" style="font-size:18px;color:#cbd5e1;">Nenhuma matéria em destaque.</div>
      <div class="label" style="margin-top:8px;">Votação <span id="t-vstatus" style="color:#38bdf8;"></span></div>
      <div id="t-question" class="question">Aguardando abertura de votação</div>
      <div class="counts">
        <div class="count-box sim"><div id="c-sim" class="num">0</div><div class="lbl">SIM</div></div>
        <div class="count-box nao"><div id="c-nao" class="num">0</div><div class="lbl">NÃO</div></div>
        <div class="count-box abs"><div id="c-abs" class="num">0</div><div class="lbl">ABSTENÇÃO</div></div>
      </div>
    </div>
    <div class="panel">
      <div class="label">Quórum Presente</div>
      <div id="t-quorum" class="big-stat">0</div>
      <div class="label" style="margin-top:8px;">Tribuna / Orador</div>
      <div id="t-speech" class="box" style="font-size:18px;">Tribuna livre</div>
      <div class="label" style="margin-top:auto;">Último Sequencial Assinado</div>
      <div id="t-seq" style="font-family:monospace;font-size:20px;color:#cbd5e1;">#0</div>
    </div>
  </div>
  <div class="footer">
    <span>Dispositivo Local: ${escapeHtml(meta.deviceId)}</span>
    <span>Operação em Rede Interna (LAN)</span>
  </div>
  <script>
    let sessionId = ${JSON.stringify(initialSession)};
    let frozenCache = null;

    async function resolveSession() {
      if (sessionId) return sessionId;
      const st = await fetch('/api/local/status').then(r => r.json());
      if (st.sessions && st.sessions.length > 0) {
        sessionId = st.sessions[0].sessionId;
        document.getElementById('t-session').textContent = sessionId;
      }
      return sessionId;
    }

    function applySnapshot(snap) {
      if (!snap) return;
      const frozenEl = document.getElementById('t-frozen');
      if (snap.displayFrozen) {
        frozenEl.style.display = 'inline-flex';
        frozenEl.classList.add('frozen');
        if (!frozenCache) frozenCache = snap;
        return;
      }
      frozenCache = null;
      frozenEl.style.display = 'none';
      document.getElementById('t-quorum').textContent = String((snap.presentParliamentarianIds || []).length);
      document.getElementById('t-seq').textContent = '#' + (snap.lastSequence || 0);
      document.getElementById('t-agenda').textContent = snap.activeAgendaItem
        ? snap.activeAgendaItem.title + (snap.activeAgendaItem.incident ? ' [' + snap.activeAgendaItem.incident.toUpperCase() + ']' : '')
        : 'Nenhuma matéria em destaque.';
      document.getElementById('t-speech').textContent = snap.activeSpeech && snap.activeSpeech.active
        ? 'Orador: ' + snap.activeSpeech.parliamentarianId + (snap.activeSpeech.aparteBy ? ' (Aparte: ' + snap.activeSpeech.aparteBy + ')' : '')
        : 'Tribuna livre';
      const v = snap.activeVoting;
      document.getElementById('t-question').textContent = v ? v.question : 'Aguardando abertura de votação';
      document.getElementById('t-vstatus').textContent = v ? '(' + (v.status === 'open' ? 'ABERTA' : 'ENCERRADA') + ')' : '';
      document.getElementById('c-sim').textContent = v ? String(v.counts.sim) : '0';
      document.getElementById('c-nao').textContent = v ? String(v.counts.nao) : '0';
      document.getElementById('c-abs').textContent = v ? String(v.counts.abstencao) : '0';
    }

    async function refresh() {
      const sid = await resolveSession();
      if (!sid) return;
      const snap = await fetch('/api/local/sessions/' + encodeURIComponent(sid) + '/snapshot').then(r => r.json());
      applySnapshot(snap);
    }

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(proto + '//' + location.host + '/ws?kind=telao');
      ws.onopen = () => { document.getElementById('t-ws').textContent = 'LAN Conectada'; };
      ws.onclose = () => { document.getElementById('t-ws').textContent = 'Reconectando…'; setTimeout(connect, 2500); };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.event === 'session.snapshot' && msg.data && msg.data.snapshot) {
            if (!sessionId) sessionId = msg.data.sessionId;
            applySnapshot(msg.data.snapshot);
            return;
          }
          if (msg.data && msg.data.sessionId && !sessionId) {
            sessionId = msg.data.sessionId;
            document.getElementById('t-session').textContent = sessionId;
          }
        } catch {}
        refresh();
      };
    }

    refresh();
    connect();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`
}

export function renderLanVereadorHtml(meta: { tenantId: string; deviceId: string; sessionId?: string }): string {
  const initialSession = meta.sessionId ?? ''
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Terminal do Vereador (LAN) — edocBR Plenário</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; padding: 18px; max-width: 540px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
    .header { background: #0f172a; color: #f8fafc; padding: 14px 16px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.06em; }
    input { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    button { padding: 12px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; font-size: 14px; font-weight: 700; cursor: pointer; }
    .btn-in { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
    .btn-sim { background: #15803d; color: #fff; border-color: #15803d; }
    .btn-nao { background: #b91c1c; color: #fff; border-color: #b91c1c; }
    .btn-abs { background: #b45309; color: #fff; border-color: #b45309; }
    .receipt { background: #f1f5f9; border-radius: 8px; padding: 10px; font-family: monospace; font-size: 12px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div style="font-weight:700;font-size:15px;">Terminal do Vereador (LAN)</div>
      <div style="font-size:11px;color:#94a3b8;">Câmara: ${escapeHtml(meta.tenantId)}</div>
    </div>
    <span id="v-ws" style="font-size:11px;background:#1e293b;padding:4px 10px;border-radius:999px;">Conectando…</span>
  </div>
  <div class="card">
    <div class="label">Identificação na Sessão</div>
    <input id="v-sess" placeholder="ID da Sessão" value="${escapeHtml(initialSession)}" />
    <input id="v-parl" placeholder="ID do Parlamentar (ex: parl_1)" value="parl_1" />
    <div class="row">
      <button class="btn-in" onclick="markAttendance('check_in')">Registrar Presença</button>
      <button onclick="markAttendance('check_out')">Registrar Saída</button>
    </div>
  </div>
  <div class="card">
    <div class="label">Votação Ativa</div>
    <div id="v-question" style="font-size:16px;font-weight:700;">Nenhuma votação aberta</div>
    <div id="v-status" style="font-size:12px;color:#64748b;">Aguardando mesa local…</div>
    <div class="row3">
      <button class="btn-sim" onclick="vote('sim')">SIM</button>
      <button class="btn-nao" onclick="vote('nao')">NÃO</button>
      <button class="btn-abs" onclick="vote('abstencao')">ABSTER</button>
    </div>
  </div>
  <div class="card">
    <div class="label">Recibo Criptográfico Local</div>
    <div id="v-receipt" class="receipt">Nenhum ato enviado nesta sessão.</div>
  </div>
  <script>
    let activeVotingId = null;

    async function ensureSession() {
      const el = document.getElementById('v-sess');
      if (el.value.trim()) return el.value.trim();
      const st = await fetch('/api/local/status').then(r => r.json());
      if (st.sessions && st.sessions.length > 0) {
        el.value = st.sessions[0].sessionId;
      }
      return el.value.trim();
    }

    async function refresh() {
      const sid = await ensureSession();
      if (!sid) return;
      const snap = await fetch('/api/local/sessions/' + encodeURIComponent(sid) + '/snapshot').then(r => r.json());
      const v = snap.activeVoting;
      activeVotingId = v && v.status === 'open' ? v.id : null;
      document.getElementById('v-question').textContent = v ? v.question : 'Nenhuma votação aberta';
      document.getElementById('v-status').textContent = v
        ? (v.status === 'open' ? 'Votação ABERTA — toque para votar' : 'Votação ENCERRADA')
        : 'Aguardando mesa local…';
    }

    async function markAttendance(kind) {
      const sid = await ensureSession();
      const pid = document.getElementById('v-parl').value.trim();
      if (!sid || !pid) return;
      const res = await fetch('/api/local/sessions/' + encodeURIComponent(sid) + '/attendance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parliamentarianId: pid, kind, commandId: crypto.randomUUID() })
      }).then(r => r.json());
      document.getElementById('v-receipt').textContent = JSON.stringify(res.event ? { seq: res.event.sequence, hash: res.event.eventHash } : res);
      refresh();
    }

    async function vote(value) {
      const sid = await ensureSession();
      const pid = document.getElementById('v-parl').value.trim();
      if (!sid || !pid || !activeVotingId) {
        document.getElementById('v-receipt').textContent = 'Nenhuma votação aberta no momento.';
        return;
      }
      const res = await fetch('/api/local/sessions/' + encodeURIComponent(sid) + '/votes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ votingId: activeVotingId, parliamentarianId: pid, value, commandId: crypto.randomUUID() })
      }).then(r => r.json());
      document.getElementById('v-receipt').textContent = JSON.stringify(res.receipt || res);
      refresh();
    }

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(proto + '//' + location.host + '/ws?kind=vereador');
      ws.onopen = () => { document.getElementById('v-ws').textContent = 'LAN OK'; };
      ws.onclose = () => { document.getElementById('v-ws').textContent = 'Reconectando…'; setTimeout(connect, 2500); };
      ws.onmessage = () => { refresh(); };
    }

    refresh();
    connect();
  </script>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
