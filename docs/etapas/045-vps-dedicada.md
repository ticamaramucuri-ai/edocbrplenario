# 045 — Preparação da VPS dedicada

**Estado em 06/11/2026:** ambiente de homologação sintética instalado e saudável em host separado. A fase 045 permanece aberta para ensaios de recuperação, observador externo contínuo e aceite institucional.

## Objetivo e limite

Preparar uma VPS exclusiva para ensaiar o edocBR Plenário fora do computador de desenvolvimento, sem usar dados reais de Câmara, credenciais de outras instalações ou integrações institucionais. O acesso à aplicação ocorre por túnel SSH enquanto domínio e TLS não forem definidos.

## Base instalada

- Ubuntu 26.04.1 LTS, x86_64; 6 vCPU, 11 GiB de RAM e 193 GiB de disco raiz no inventário inicial.
- Usuário `suporteplenario` com autenticação por chave SSH e acesso ao grupo Docker. A chave pública foi instalada no usuário; a privada não foi transferida.
- Docker Engine 29.9.3, Compose v5.7.0, Buildx, Git, Python 3 e cliente PostgreSQL, usando o [repositório oficial do Docker para Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
- Docker habilitado no boot; NTP sincronizado.
- Projeto recebido como bundle Git do commit `d97bfb2e2e5f865acf2f5b24e62846ee10a27deb`, sem copiar `.env`, bancos ou arquivos ignorados do desenvolvimento.
- Segredos de banco, tempo real, administrador e monitor gerados na própria VPS em `deploy/staging/.env` (modo `0600`). Seus valores não entram neste relatório.
- Stack sintética: PostgreSQL, Redis, app, realtime, webhooks, scheduler e gateway. Foram aplicadas 18 migrações e criado somente o tenant `staging-example`.

## Verificações feitas

| Verificação | Resultado |
|---|---|
| Build do commit fixado | Passou, com compilação Next.js e TypeScript |
| `staging-image-proof.py` | `ok=true`; app, realtime, webhooks e scheduler saudáveis na mesma imagem e revisão |
| `GET /api/v1/health?ready=1` pelo gateway | HTTP 200 |
| `GET /` pelo gateway | HTTP 200 |
| Tentativa externa às portas 3181, 3100 e 55432 | Todas fechadas para o observador deste computador |
| Túnel SSH local para gateway | HTTP 200 em `127.0.0.1:4181` |

O Docker publica banco, app, realtime e gateway somente em `127.0.0.1` no host. SSH é a única porta pública observada no preparo. A prova de portas é pontual e não substitui varredura periódica ou revisão do firewall do provedor.

## Correção descoberta na instalação

No primeiro `stack-up`, o healthcheck do app aguardava `/api/v1/bootstrap` antes de o seed criar o tenant sintético. O bootstrap devolvia 404 e a instalação aguardava indefinidamente. A instalação foi concluída executando o seed antes de esperar o app. O roteiro `scripts/staging-postgres.py` foi alterado para fazer essa semeadura antes de subir app e workers, eliminando o ciclo na próxima instalação limpa.

## Operação e acesso

O checkout está em `/home/suporteplenario/edocbr-plenario` na VPS. Para acessar a aplicação do computador autorizado, encaminhe uma porta local ao gateway remoto:

```bash
ssh -N -L 127.0.0.1:4181:127.0.0.1:3181 suporteplenario@HOST_DA_VPS
```

Abra `http://127.0.0.1:4181/`. O tenant e as contas criados são exclusivamente sintéticos. As senhas ficam no `.env` privado do host e devem ser consultadas por operador autorizado, sem colá-las em issue, commit ou relatório.

Para verificar a implantação no host:

```bash
cd /home/suporteplenario/edocbr-plenario
python3 scripts/staging-postgres.py stack-status
python3 scripts/staging-image-proof.py
```

Não executar `docker compose down -v`: isso remove o banco e a mídia persistentes.

## Próximas provas da fase 045

1. Configurar observador em máquina distinta, timer e histórico de indisponibilidade.
2. Testar backup conjunto de banco, fotos, gravações e replay com restauração limpa; medir RPO/RTO.
3. Executar matriz de falhas de serviços e reinício do host com medição externa.
4. Monitorar renovação do certificado e definir a política de acesso do laboratório; Full (strict) foi confirmado pelo administrador da zona.
5. Validar, com a Câmara, dados regimentais, usuários e aceite do piloto. Integrações Nextcloud/Alfresco seguem para a etapa de integração, após estabilizar o núcleo.

**Decisão:** este host passa a servir como laboratório dedicado de homologação. Ainda não é produção nem piloto oficial da Câmara de Mucuri.

## Ativação do domínio em 06/11/2026

Após delegação do DNS à Cloudflare, o Caddy oficial 2.11.9 foi instalado como serviço do host e configurado como proxy para o gateway local `127.0.0.1:3181`. Certificados Let's Encrypt foram emitidos para `edocbrplenario.com.br` e `www.edocbrplenario.com.br`; o serviço foi habilitado no boot. O modelo de configuração é [`deploy/vps/Caddyfile.example`](../../deploy/vps/Caddyfile.example).

Provas externas: HTTPS do origin validado sem ignorar certificado, `GET /` e `GET /api/v1/health?ready=1` pela Cloudflare com HTTP 200, `www` com redirecionamento 301, conexão WebSocket do Socket.IO estabelecida. As portas 3100, 3103, 3181, 5432 e 55432 permaneceram fechadas externamente. O certificado do origin tem validade até 04/02/2027 e renovação automática gerida pelo Caddy.

O domínio expõe **somente a stack sintética**. O cabeçalho `X-Robots-Tag: noindex, nofollow, noarchive` reduz a indexação durante a homologação. O administrador da zona confirmou o modo SSL/TLS **Full (strict)** na Cloudflare; essa configuração não foi lida diretamente por uma API nesta execução. Dados e aceite da Câmara, backup/restauração externa e matriz de falhas seguem pendentes.

## Promoção GitHub → VPS em 06/11/2026

O commit `ceb885856cf160735dcb86401e5a0585279744b9` foi aprovado nos três jobs da CI e promovido com `scripts/promote-vps.sh`. O build foi feito a partir do arquivo do commit fixado; a migração e a subida da stack sintética terminaram com app, realtime, webhooks, scheduler, PostgreSQL e Redis saudáveis. O checkout de `/home/suporteplenario/edocbr-plenario` na VPS confirmou o mesmo SHA, sem alterações locais.

Verificação pública feita após a promoção: homepage HTTP 200; `/api/v1/health?ready=1` HTTP 200 com `ok=true`, `database=ready` e a versão acima; `X-Robots-Tag: noindex, nofollow, noarchive`. A [rotina do observador externo](045-observador-publico-externo.md) foi preparada para dar continuidade a essas verificações de 15 em 15 minutos quando publicada na branch padrão.

Esta é uma promoção de staging, não uma liberação de produção. Backup/restauração fora do host, alertas, sonda externa autenticada dos workers e ensaio da matriz de falhas ainda são necessários para fechar a fase 045.
