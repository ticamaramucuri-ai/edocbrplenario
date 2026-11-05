# 049 — Deliberação em PostgreSQL com duas instâncias HTTP

**Data:** 05/11/2026. **Estado:** ensaio sintético local concluído; sem host separado ou aceite regimental.

`scripts/staging-multi-app-deliberation.py` recusa uma base que não contenha exclusivamente `staging-example`, exige stack saudável e ausência de sessão ativa. Sobe um segundo contêiner `app` com a mesma imagem e o mesmo PostgreSQL, mas processo e porta próprios. Usa contas sintéticas e sete parlamentares fictícios; distribui criação, presença, abertura e votos entre as duas URLs. Na saída, encerra a sessão de prova em caso de falha e remove o contêiner auxiliar.

**Defeito encontrado:** antes da correção, a mesma chave de voto enviada simultaneamente aos dois processos retornava **[200, 500]**. Ambos haviam lido a ausência do comando; um `INSERT` perdia a disputa do índice único do PostgreSQL e o erro escapava como 500. `castVote` agora trata somente o conflito único `P2002`: relê o comando confirmado e devolve o mesmo voto quando ator, parlamentar e valor coincidem; conteúdo divergente continua recebendo 409. A transação perdedora não grava auditoria nem evento extra.

**Prova após correção:** o banco sintético recebeu as migrações 0016–0018 e a imagem de staging foi reconstruída. O roteiro passou duas vezes, com `appContainers: 2`, `duplicateStatuses: [200, 200]`, fechamento simultâneo `[200, 409]`, **7 votos, 7 recibos, 7 eventos de auditoria** e contagem independente de **4 sim, 3 não**, resultado `aprovado`. Ata lida pela instância B e portal lido pela A coincidiram com o banco. `bun run typecheck`, ESLint do serviço e `bun run test:voting:flow-guards` passaram (3 testes, 40 asserções).

**Reprodução em stack fictícia exclusiva:**

```bash
python3 scripts/staging-postgres.py up
docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yaml build app
docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yaml up -d --no-deps app
bun run test:staging:multi-app-deliberation
```

O ensaio usa duas instâncias, porém no **mesmo host** e em uma Câmara fictícia; não prova falha de rede, quórum regimental de Mucuri, canal institucional ou carga de longa duração. A conferência simbólica oficial ainda precisa de duas identidades e matriz aprovada no ambiente alvo. As integrações Nextcloud/Alfresco continuam posteriores ao piloto.
