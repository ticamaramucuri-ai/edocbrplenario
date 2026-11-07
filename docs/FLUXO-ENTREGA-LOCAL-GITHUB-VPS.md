# Fluxo de entrega — local → GitHub → VPS

**Estado em 07/11/2026:** VPS de homologação sintética ativa e promoção por GitHub comprovada no SHA `ceb885856cf160735dcb86401e5a0585279744b9`. Domínio HTTPS ativo para ensaio; observador público foi preparado e aguarda publicação; a fase 045 ainda exige recuperação externa e aceite institucional.

## Ambientes e responsabilidade

| Etapa | Local | Regra de saída |
|---|---|---|
| Desenvolvimento | `/home/suporte/Work/edocBRplenario2` | Alteração revisada, testes relevantes e commit identificado |
| Fonte e CI | [`e-docBR/edocBRplenario`](https://github.com/e-docBR/edocBRplenario), privado | `main` com workflow **CI** concluído com sucesso no SHA exato |
| Homologação | VPS dedicada, checkout de `suporteplenario` | Mesmo SHA obtido do GitHub, imagem e serviços saudáveis, prontidão HTTP 200 |

Desenvolver em branch `codex/*` ou outra branch de trabalho, abrir PR, analisar a CI e mesclar em `main`. A organização ainda não tem proteção de branch configurável neste plano do GitHub; por isso o operador deve verificar o workflow antes da promoção. Push direto em `main` não promove automaticamente a VPS. O histórico da VPS é somente leitura em relação ao GitHub: sua chave de deploy exclusiva não permite push.

## Promoção para a VPS

O operador local, depois de mesclar e obter a CI verde no SHA de `main`, executa:

```bash
export EDOCBR_VPS_SSH_TARGET='suporteplenario@HOST_DA_VPS'
export EDOCBR_VPS_SSH_IDENTITY='/CAMINHO/DA/CHAVE_SSH_DA_VPS'
bash scripts/promote-vps.sh "$(git rev-parse origin/main)"
```

O comando recusa revisão diferente do `main` remoto, alterações rastreadas locais ou CI ausente, falha ou em execução. Na VPS ele busca `main` por chave de deploy somente leitura, fixa o checkout no SHA, constrói a imagem a partir do `git archive` desse SHA, aplica migrações, sobe serviços, verifica os rótulos de revisão e consulta `/api/v1/health?ready=1`. A saída JSON registra a revisão anterior e a implantada, sem segredos. O arquivo privado `deploy/staging/.env` e os volumes persistentes não são sincronizados pelo Git.

**Falha de promoção:** não presumir rollback automático de banco. Parar a promoção, preservar logs, identificar a migração e a revisão executada e restaurar a partir de backup conjunto quando necessário. Antes de cada mudança de esquema ou versão operacional, fazer backup de banco, imagens, gravações e replay e verificar seu manifesto. O ensaio de restauração fora do host ainda está pendente na fase 045.

## Domínio e HTTPS

O nome escolhido é **`edocbrplenario.com.br`**. Em 06/11, a delegação passou de nameservers de estacionamento para `jonah.ns.cloudflare.com` e `raquel.ns.cloudflare.com`. Caddy no host obteve certificados Let's Encrypt para o domínio principal e `www`; HTTPS, redirecionamento e WebSocket passaram em verificação externa. O [registro da fase 045](etapas/045-vps-dedicada.md) contém as provas. O conteúdo servido ainda é exclusivamente sintético.

Para manter e depois oficializar o domínio:

1. Manter registros de `@` e `www` apontados à VPS, com proxy Cloudflare; não publicar IPv6 de origin sem interface IPv6 configurada na VPS.
2. Manter **Full (strict)** na Cloudflare, conforme confirmação do administrador da zona. O origin apresenta certificado válido e renovação automática via [Caddyfile](../deploy/vps/Caddyfile.example); a configuração da conta não foi lida diretamente por API.
3. Repetir periodicamente HTTPS, redirecionamento `www`, WebSocket, sessão autenticada e saúde a partir de fora da VPS. Manter PostgreSQL, Redis e portas internas fora da Internet.
4. Definir se o domínio raiz servirá o ambiente institucional ou uma página de entrada. O tenant `staging-example` é de laboratório e não deve ser apresentado como Câmara oficial.

O [modo Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/) valida o certificado do origin; [Caddy](https://caddyserver.com/docs/automatic-https) pode emitir e renovar automaticamente quando o domínio e as portas estiverem preparados.

## Próximos critérios

- Promoção por GitHub comprovada no SHA `ceb885856cf160735dcb86401e5a0585279744b9`, com CI verde, prova da imagem/saúde na VPS e verificação pública HTTPS. Repetir para cada mudança.
- Publicar o [observador público da fase 045](etapas/045-observador-publico-externo.md) e obter a primeira execução em máquina fora da VPS.
- Backup e restauração conjunta medidos fora do host, observador externo e matriz de falhas da fase 045.
- Monitorar o certificado, HTTPS externo e a configuração Full (strict) confirmada pelo administrador da zona.
- Somente depois, dados regimentais e aceite institucional do piloto. Nextcloud e Alfresco permanecem na fase final de integração.
