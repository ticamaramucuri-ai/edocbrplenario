# Task 34-b — full-stack-developer (Fase 22: Confiança de acesso e assinatura eletrônica)

Registros de trabalho do subagente da Task 34-b (Onda 5 / Fase 22 do ROADMAP §12.2).

## Escopo entregue (ownership respeitado)

**Backend**
- `src/lib/server/totp.ts` (NOVO): TOTP RFC 6238 nativo com node:crypto — base32 RFC 4648
  encode/decode, `generateTotpSecret()` (20 bytes), `totpCode(secret, atMs)` (HMAC-SHA1,
  6 dígitos, 30s), `verifyTotp` com drift ±1, `otpauthUrl(secret, email)`. Vetores do RFC
  6238 conferem (t=59s → 287082).
- `POST /api/v1/auth/mfa/setup` (segredo pendente só com mfaEnabled=false; 422 se ativo;
  MfaSetupView; SEM auditoria — dado sensível).
- `POST /api/v1/auth/mfa/enable` (TOTP válido → mfaEnabled=true + auditoria `user.mfa_enabled`
  sem o segredo; inválido → 401; sem segredo pendente → 422).
- `POST /api/v1/auth/mfa/disable` (senha + TOTP → mfaEnabled=false E mfaSecret=null + auditoria
  `user.mfa_disabled`).
- `GET /api/v1/auth/mfa/status` (NOVO, necessário para o badge do card "Meu acesso":
  resolveActor → `{ mfaEnabled }`; funciona com sessão OU modo demo).
- `POST /api/v1/auth/login/mfa` (senha + mfaEnabled + TOTP → sessão igual ao login, mesmo
  shape de `{ actor }`; falhas → 401 genérico).
- `src/app/api/v1/auth/login/route.ts` (EDITADO): após senha válida, `mfaEnabled` →
  `throw mfaRequired()` (401 code MFA_REQUIRED, SEM sessão/cookie).
- `GET /api/v1/auth/sessions` (lista com `current` via sha256 do token do cookie).
- `DELETE /api/v1/auth/sessions/[id]` (revoga só do próprio usuário, idempotente, encerra
  impersonação ativa).
- `src/lib/server/session.ts` (EDITADO): `lastUsedAt` best-effort com throttle de 5 min
  (fire-and-forget) na resolução de sessão válida. resolveActor/actor.ts intocado.
- `POST /api/v1/me/ata/sign` (requirePermission 'self.vote' + requireMeParliamentarian;
  última sessão closed com ata publicada; presença via currentAttendance; idempotente por
  (documentId, signatoryParliamentarianId) em transação serializada com withTransaction;
  cadeia prevHash = hash completo da última; auditoria `ata.signed`).
- `GET /api/v1/reports/session/[id]/ata/signatures` (AtaSignaturesView: eligible com
  signed/signedAt/signatureCode, signatures por signedAt, docHash recomputado, chainValid
  por recompute + elos).
- `GET /api/v1/public/documents/ata/[sessionId]?tenant=` (PublicAtaView; 404 sem ata/tenant).
- `GET /api/v1/public/documents/verify-signature?code=` (rate limited 30/min/IP bucket
  `public:verify` + rateLimitedProblem; código inexistente → 200 valid=false; validade =
  código recomputado + publicação published + docHash = sha256 do conteúdo atual).

**Frontend**
- `src/components/app/login-form.tsx`: 2 passos — 401 `body.code === 'MFA_REQUIRED'` → passo 2
  com InputOTP 6 dígitos + POST /auth/login/mfa (fetch direto same-origin) → onLoggedIn;
  link "voltar" reexibe passo 1.
- `src/modules/users/index.tsx`: card "Meu acesso" no topo (qualquer papel): MFA
  (badge ativo/desativado, Dialog setup com segredo mono + otpauth + instruções + InputOTP →
  mfaApi.enable; Dialog disable com senha + InputOTP → mfaApi.disable) + sessões ativas
  (userAgent resumido, IP, criada em, último uso, badge "Atual", AlertDialog "Encerrar" com
  nota "é esta sessão" → authSessionsApi). Gestão de usuários segue abaixo quando canManage.
- `src/modules/reports/index.tsx`: painel "Assinaturas eletrônicas" na tab Minuta de Ata
  (signaturesApi.ataPanel): badges X/Y assinadas, tabela de elegíveis (código mono + horário
  / Pendente), selo "Cadeia verificada ✓", docHash, nota ADR-023 (presença, nunca o voto) e
  instrução de assinatura pelo App do Parlamentar.
- `src/modules/pwa/index.tsx`: card "Assinar ata da sessão de {data}" (signaturesApi.ataPanel
  da sessão em foco closed; só se elegível) com botão → signaturesApi.signAta() → toast com
  o código + badge "Ata assinada" com código/horário; invalidação realtime.
- `src/modules/portal/index.tsx`: seção "Ata publicada" + "Assinado eletronicamente por"
  (nome + horário + código, selo de cadeia, sha256) no SessionDetailSheet de sessão
  encerrada + campo de verificação por código (input + botão "Verificar autenticidade" →
  signaturesApi.verifySignature → selo válido/inválido).

**Docs**
- `docs/adr/ADR-023-confianca-acesso-assinatura.md` (NOVO): TOTP nativo drift ±1, login 2
  passos sem sessão no 401, sessões com revogação, cadeia HMAC análoga ao ADR-019,
  presença-nunca-voto, caminho de produção (OIDC/SAML, ICP-Brasil, HSM/KMS, rotação).

## Evidências de verificação (curl, cookie jar /tmp/cj*)
- login Ana 200 → mfa/setup (secret+otpauthUrl) → código TOTP via bun → enable 200 →
  **login sem código → 401 MFA_REQUIRED sem cookie** → login/mfa 200 + cookie →
  auth/sessions com current:true → revoke idempotente 200 → disable 200 → login normal 200.
- Painel Ana (s1): 4/11 assinadas, chainValid true. POST /me/ata/sign com Carla → 200
  idempotente (assinatura do seed); delete da assinatura seed + re-sign → 200 nova linha,
  cadeia válida (prevHash correto).
- Público: /public/documents/ata/{s1}?tenant=camara-vila-nova → 200 4 assinaturas; código
  real → valid true (case-insensitive ok); inventado → valid false 200; 31ª chamada <1min →
  **429 + Retry-After: 55**.
- TOTP unit smoke (bun): ±0/±1 aceitos, −3 janelas rejeitado, aleatório rejeitado,
  determinístico, base32 roundtrip, RFC 6238 vector 287082 ✓.
- `bun run lint` 0 erros/0 warnings; `bunx tsc --noEmit` sem erros nos arquivos do escopo
  (divergências pré-existentes NextRequest/Request e mini-services mantidas).
- dev.log sem erros de runtime; `bun prisma/seed.ts` re-executado ao final → base prístina
  (4 assinaturas seed, painel 4/11 chainValid true, home 200).

## Notas para o main
- Dev server na 3000 estava CAÍDO durante parte da task (nada na porta; EADDRINUSE ao
  duplicar) — reiniciado manualmente com `nohup bun run dev` (detached); se o supervisor
  do sistema voltar a flappar, vale chechar.
- `GET /auth/mfa/status` foi criação necessária dentro do ownership (/api/v1/auth/**) para
  alimentar o badge do card "Meu acesso" (nenhum endpoint existia com o estado do MFA).
- Portal: a seção de assinaturas vive no detalhe público da SESSÃO (SessionDetailSheet) —
  a publicação do diário não expõe sessionId na view pública (publications.ts fora do
  ownership), e a ata pública é naturalmente o detalhe da sessão encerrada.
- worklog.md atualizado com a entrada da Task 34-b (formato padrão).
