# Etapa 045 — versão observável nos serviços

**Data:** 04/11/2026. **Estado:** incremento local concluído; verificação fora do host pendente.

O app expõe `GET /api/v1/health`; realtime, webhooks, scheduler (SQLite e PostgreSQL) e worker de correio incluem `version` em `/health`. O valor vem de `EDOCBR_BUILD_VERSION`. A stack de homologação repassa `STAGE_BUILD_VERSION` a todos os processos; na ausência do valor, `local-unversioned` explicita que a revisão implantada não pode ser identificada. A sonda `staging-remote-check.py` registra a versão do app e das sondas diretas, além das sondas indiretas retornadas por `platform/system-status`.

**Verificação local:** `python3 -I tests/test-staging-remote-check.py`, `bun run lint`, `bun run typecheck` e `GET /api/v1/health` na aplicação local. O teste cobre a versão simulada em app/realtime/webhooks, falha de serviço e relógio divergente. A leitura local retornou `local-unversioned`, como esperado sem variável de deploy.

**Próxima prova:** definir `STAGE_BUILD_VERSION` como identificação imutável do build, implantar em host separado e executar a sonda a partir de observador externo com `--expected-version` igual à revisão implantada. Divergência em qualquer serviço esperado reprova a sonda. Repetir após uma atualização. O ensaio local não fecha a fase 045.
