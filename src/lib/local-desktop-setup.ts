/**
 * Servidor de primeiro acesso (Setup / Onboarding) para o edocBR Plenário Desktop.
 * Garante que o aplicativo sempre abra uma janela mesmo quando o cofre local
 * ainda não foi inicializado/pareado, permitindo configurar produção ou modo teste em 1 clique.
 */
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  initializeLocalDevice,
  enrollLocalDevice,
  trustLocalTransferKey,
  loadLocalDevice,
} from './local-device-keystore'

export type SetupCompletedPayload = {
  root: string
  passphrase: string
}

function renderSetupHtml(reason: string, root: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>edocBR Plenário Desktop — Configuração Inicial</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; min-height: 100vh; display: flex; flex-direction: column; }
    .bar { height: 48px; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; font-weight: 600; font-size: 14px; }
    .wrap { max-width: 720px; width: 100%; margin: 28px auto; padding: 0 20px; display: flex; flex-direction: column; gap: 18px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
    h1 { font-size: 20px; font-weight: 800; }
    h2 { font-size: 15px; font-weight: 700; }
    p { font-size: 13.5px; color: #475569; line-height: 1.5; }
    .warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 10px 14px; border-radius: 8px; font-size: 12.5px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: #334155; }
    input, textarea { padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 7px; font-size: 13px; font-family: inherit; }
    textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; min-height: 68px; }
    .btn { padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 700; border: 1px solid #cbd5e1; background: #fff; color: #0f172a; cursor: pointer; }
    .btn-primary { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
    .btn-primary:hover { background: #1e40af; }
    .btn-green { background: #15803d; color: #fff; border-color: #15803d; }
    .btn-green:hover { background: #166534; }
    .msg { font-size: 13px; font-weight: 600; color: #1d4ed8; min-height: 18px; }
    .err { color: #b91c1c; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
  </style>
</head>
<body>
  <div class="bar">
    <span>edocBR Plenário Desktop — Assistente de Primeiro Acesso</span>
    <span style="font-size:12px;color:#94a3b8;">Cofre Local</span>
  </div>
  <div class="wrap">
    <div class="card">
      <h1>Bem-vindo ao edocBR Plenário Desktop</h1>
      <p>O cofre criptográfico local (<span class="mono">${esc(root)}</span>) ainda não está pronto para operação.</p>
      <div class="warn">${esc(reason)}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:4px;">
        <button class="btn btn-green" id="btn-demo" onclick="startDemo()">Criar Cofre de Teste Local (1 clique)</button>
        <span style="font-size:12px;color:#64748b;">Ideal para testar imediatamente as 6 telas, Telão LAN e Terminal do Vereador.</span>
      </div>
      <div id="status-msg" class="msg"></div>
    </div>

    <div class="card">
      <h2>Ou parear com uma Câmara em Produção</h2>
      <div class="grid">
        <label>ID da Câmara (tenantId)<input id="f-tenant" placeholder="ex: camara-mucuri" /></label>
        <label>URL do SaaS (HTTPS)<input id="f-url" value="https://edocbrplenario.com.br" /></label>
        <label>ID do Dispositivo (deviceId)<input id="f-device" placeholder="ex: desktop-plenario-1" /></label>
        <label>Senha do Cofre Local<input id="f-pass" type="password" placeholder="mínimo 8 caracteres" /></label>
        <label>Key ID da Câmara<input id="f-keyid" placeholder="ex: transfer-key-1" /></label>
        <label>SHA-256 SPKI da Chave Pública<input id="f-sha" placeholder="64 caracteres hex" /></label>
      </div>
      <label>Chave Pública PEM da Câmara (Ed25519)<textarea id="f-pem" placeholder="-----BEGIN PUBLIC KEY-----&#10;...&#10;-----END PUBLIC KEY-----"></textarea></label>
      <div>
        <button class="btn btn-primary" onclick="configureProd()">Salvar e Abrir Aplicativo</button>
      </div>
    </div>
  </div>
  <script>
    function setMsg(text, isErr) {
      const el = document.getElementById('status-msg');
      el.textContent = text;
      el.className = isErr ? 'msg err' : 'msg';
    }
    async function waitAndReload() {
      setMsg('Cofre configurado! Iniciando servidor LAN…', false);
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 350));
        try {
          const r = await fetch('/health');
          const d = await r.json();
          if (d && d.service === 'edocbr-local-desktop') {
            location.reload();
            return;
          }
        } catch {}
      }
      location.reload();
    }
    async function startDemo() {
      document.getElementById('btn-demo').disabled = true;
      setMsg('Gerando chaves Ed25519 e criando cofre local…', false);
      try {
        const res = await fetch('/api/setup/demo', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Falha ao criar cofre de teste.');
        await waitAndReload();
      } catch (e) {
        document.getElementById('btn-demo').disabled = false;
        setMsg(e.message, true);
      }
    }
    async function configureProd() {
      setMsg('Validando e salvando cofre…', false);
      try {
        const res = await fetch('/api/setup/configure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: document.getElementById('f-tenant').value.trim(),
            baseUrl: document.getElementById('f-url').value.trim(),
            deviceId: document.getElementById('f-device').value.trim(),
            passphrase: document.getElementById('f-pass').value,
            keyId: document.getElementById('f-keyid').value.trim(),
            spkiSha256: document.getElementById('f-sha').value.trim(),
            publicKeyPem: document.getElementById('f-pem').value.trim(),
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Falha na configuração.');
        await waitAndReload();
      } catch (e) {
        setMsg(e.message, true);
      }
    }
  </script>
</body>
</html>`
}

export function startLocalSetupServer(args: {
  root: string
  passphraseFile: string
  reason: string
  hostname: string
  port: number
  onConfigured: (payload: SetupCompletedPayload) => void
}) {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })

  const server = Bun.serve({
    hostname: args.hostname,
    port: args.port,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/health') {
        return json({ ok: true, service: 'edocbr-local-setup', needsSetup: true })
      }
      if (url.pathname === '/' && req.method === 'GET') {
        return new Response(renderSetupHtml(args.reason, args.root), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      if (url.pathname === '/api/setup/demo' && req.method === 'POST') {
        try {
          await mkdir(dirname(args.root), { recursive: true, mode: 0o700 })
          await rm(args.root, { recursive: true, force: true })
          const passphrase = randomBytes(18).toString('hex')
          await writeFile(args.passphraseFile, passphrase + '\n', { mode: 0o600 })
          await chmod(args.passphraseFile, 0o600)

          await initializeLocalDevice({
            root: args.root,
            tenantId: 'camara-teste-local',
            baseUrl: 'https://edocbrplenario.com.br',
            passphrase,
          })
          await enrollLocalDevice(args.root, 'desktop-teste-1')
          const kp = generateKeyPairSync('ed25519')
          const pubPem = kp.publicKey.export({ type: 'spki', format: 'pem' }).toString()
          const sha = createHash('sha256')
            .update(kp.publicKey.export({ type: 'spki', format: 'der' }))
            .digest('hex')
          await trustLocalTransferKey({
            root: args.root,
            keyId: 'demo-transfer-key',
            publicKeyPem: pubPem,
            expectedSpkiSha256: sha,
          })
          await loadLocalDevice({ root: args.root, passphrase })
          setTimeout(() => args.onConfigured({ root: args.root, passphrase }), 50)
          return json({ ok: true })
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) }, 400)
        }
      }
      if (url.pathname === '/api/setup/configure' && req.method === 'POST') {
        try {
          const body = (await req.json()) as Record<string, string>
          if (!body.tenantId || !body.baseUrl || !body.deviceId || !body.passphrase || !body.keyId || !body.publicKeyPem || !body.spkiSha256) {
            return json({ error: 'Preencha todos os campos obrigatórios.' }, 422)
          }
          await mkdir(dirname(args.root), { recursive: true, mode: 0o700 })
          await rm(args.root, { recursive: true, force: true })
          await writeFile(args.passphraseFile, body.passphrase.trim() + '\n', { mode: 0o600 })
          await chmod(args.passphraseFile, 0o600)

          await initializeLocalDevice({
            root: args.root,
            tenantId: body.tenantId,
            baseUrl: body.baseUrl,
            passphrase: body.passphrase.trim(),
          })
          await enrollLocalDevice(args.root, body.deviceId)
          await trustLocalTransferKey({
            root: args.root,
            keyId: body.keyId,
            publicKeyPem: body.publicKeyPem,
            expectedSpkiSha256: body.spkiSha256,
          })
          await loadLocalDevice({ root: args.root, passphrase: body.passphrase.trim() })
          setTimeout(() => args.onConfigured({ root: args.root, passphrase: body.passphrase.trim() }), 50)
          return json({ ok: true })
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) }, 400)
        }
      }
      return json({ error: 'Rota não encontrada.' }, 404)
    },
  })

  return {
    server,
    port: server.port,
    close() {
      server.stop(true)
    },
  }
}
