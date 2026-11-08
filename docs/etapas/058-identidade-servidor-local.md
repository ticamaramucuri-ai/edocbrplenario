# P4 — identidade do servidor local por Câmara

**Estado em 07/11/2026:** cadastro, designação, revogação e autenticação de pedido assinada implementados e ensaiados com dados fictícios. Não há download de pacote nem autoridade de sessão.

## Entrega

- `LocalServerDevice` guarda somente a chave pública Ed25519 SPKI, impressão SHA-256, nome, referência de aprovação e estado por Câmara. A impressão é única na plataforma, impedindo reutilizar a mesma identidade em duas Câmaras. A chave privada nasce e permanece no desktop; o SaaS nunca a recebe.
- `LocalServerDesignation` mantém um único ID designado por Câmara e geração crescente. A troca exige `expectedGeneration`; a revogação marca o dispositivo e limpa a designação na mesma transação. A designação permite autenticar pedidos de preparação, mas **não** concede autoridade para presença, voto ou telão.
- `GET/POST /api/v1/local-devices`, `POST /api/v1/local-devices/:id/designate` e `POST /api/v1/local-devices/:id/revoke` exigem `tenant_admin`, cookie de sessão real, login com TOTP efetivamente verificado, ausência de impersonação e, para mutações, `X-edocbr-admin-action: 1`. O login por MFA agora marca `AuthSession.mfaVerifiedAt`; sessões antigas precisam de novo login para gerir equipamento. As ações deixam auditoria sem segredo.
- `authenticateLocalDeviceRequest` verifica dispositivo ativo e designado, tenant ativo, timestamp de 2 minutos, método e caminho assinados, nonce e Ed25519. O nonce é consumido com chave única no banco; repetição retorna `LOCAL_DEVICE_REPLAY`. Ainda não há rota que chame este verificador para entregar bytes.
- A migração PostgreSQL `0020_local_server_device_identity.sql` é aditiva. Não há dispositivo designado por padrão em Câmaras existentes.

## Prova e limites

`bash scripts/test-local-device-identity.sh` usa SQLite descartável e verifica duas Câmaras, MFA, cabeçalho administrativo, chave repetida inclusive em outra Câmara, designação com geração, pedido assinado, replay, alteração da URL, revogação e auditoria. `bash scripts/test-postgres-foundation.sh` aplica a migração, copia/restaura o banco e executa a suíte PostgreSQL. `bun run typecheck` e `bun run lint` passaram. Esta prova não substitui ensaio HTTP/TLS real, relógios divergentes, concorrência entre instâncias, revogação durante download nem dispositivo físico.

**Entrega e implantação de homologação:** [PR #22](https://github.com/e-docBR/edocBRplenario/pull/22), merge `d00e64475f99185db634992fd4ebaf1adee94141`; CI da `main` 42434472734 concluída com aplicação, PostgreSQL e mídia aprovados. O promotor fixou esse SHA na VPS e aplicou 20 migrações; app, realtime, webhooks, scheduler, PostgreSQL e Redis ficaram saudáveis. Em `https://edocbrplenario.com.br`, `GET /api/v1/health` respondeu 200 e `GET /api/v1/local-devices` sem login respondeu 401. O ambiente continua sintético, sem desktop designado e sem chave institucional provisionada.

## Próxima dependência

1. Definir bootstrap do desktop: geração da chave privada no equipamento, prova da impressão digital ao administrador e distribuição autenticada da chave pública de assinatura da Câmara.
2. Implementar download do pacote completo com pedido assinado, limite de tamanho, bytes em fluxo, ACK por item e proteção contra revogação durante a resposta. Limpar nonces expirados periodicamente.
3. Ensaiar dois desktops e troca de designação sob concorrência PostgreSQL. Só depois desenhar concessão de autoridade de sessão com época/fencing token; a geração desta etapa ainda não é esse token.
