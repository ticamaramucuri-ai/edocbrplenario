# Fluxo de entrega — local → GitHub → VPS

**Estado em 06/11/2026:** VPS de homologação sintética ativa; publicação pública do domínio pendente de DNS/TLS e dos ensaios da fase 045. Este fluxo não libera o piloto institucional.

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

O nome escolhido é **`edocbrplenario.com.br`**. Na verificação de 06/11, os nameservers públicos ainda eram `cosmos.dns-parking.com` e `nova.dns-parking.com`; a página respondia como domínio estacionado na Hostinger. Portanto, a zona Cloudflare ainda não é a autoridade pública observável para esse domínio. Não alterar DNS nem publicar a stack sintética até confirmar a delegação e o acesso pretendido.

Quando a zona Cloudflare estiver delegada corretamente:

1. Criar registros `A` para o domínio raiz e `www` apontando à VPS, com proxy da Cloudflare, e remover registros de estacionamento conflitantes. Não publicar AAAA sem IPv6 configurado na VPS.
2. Habilitar **Full (strict)** na Cloudflare. Usar certificado válido no origin; o modelo de [Caddyfile](../deploy/vps/Caddyfile.example) está pronto para proxy reverso e HTTPS automático, mas deve ser ativado apenas quando DNS, portas 80/443 e emissão de certificado estiverem prontos.
3. Provar HTTPS, redirecionamento `www`, WebSocket, sessão autenticada e saúde a partir de fora da VPS. Manter PostgreSQL, Redis e portas internas fora da Internet.
4. Definir se o domínio raiz servirá o ambiente institucional ou uma página de entrada. O tenant `staging-example` é de laboratório e não deve ser apresentado como Câmara oficial.

O [modo Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/) valida o certificado do origin; [Caddy](https://caddyserver.com/docs/automatic-https) pode emitir e renovar automaticamente quando o domínio e as portas estiverem preparados.

## Próximos critérios

- CI verde no novo SHA e primeira promoção VPS feita a partir do GitHub, sem bundle local.
- Backup e restauração conjunta medidos fora do host, observador externo e matriz de falhas da fase 045.
- Delegação DNS à Cloudflare, certificado válido no origin e teste HTTPS externo.
- Somente depois, dados regimentais e aceite institucional do piloto. Nextcloud e Alfresco permanecem na fase final de integração.
