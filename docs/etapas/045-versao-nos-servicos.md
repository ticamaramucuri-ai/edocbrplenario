# Etapa 045 — versão observável nos serviços

**Data:** 04/11/2026. **Estado:** incremento local concluído; verificação fora do host pendente.

O app expõe `GET /api/v1/health`; realtime, webhooks, scheduler (SQLite e PostgreSQL) e worker de correio incluem `version` em `/health`. O valor vem de `EDOCBR_BUILD_VERSION`. A stack de homologação passa `STAGE_BUILD_VERSION` ao build da imagem compartilhada; na ausência do valor, `local-unversioned` explicita que a revisão implantada não pode ser identificada. A sonda `staging-remote-check.py` registra a versão do app e das sondas diretas, além das sondas indiretas retornadas por `platform/system-status`.

**Correção de proveniência local:** a stack antes passava `STAGE_BUILD_VERSION` como variável de runtime em cada serviço. Isso permitia trocar a versão anunciada sem trocar a imagem. O Dockerfile agora incorpora o identificador no build, expõe `EDOCBR_BUILD_VERSION` a todos os processos da mesma imagem e grava `org.opencontainers.image.revision`. O Compose passa a versão apenas como argumento de build. A sonda continua comparando app e workers com `--expected-version`; alterar o `.env` após construir a imagem não deve mudar o valor observado. O rótulo identifica a revisão declarada durante o build; provar que os bytes correspondem exatamente a um commit exige build a partir de checkout limpo ou artefato CI imutável.

**Verificação local:** `python3 -I tests/test-staging-remote-check.py`, `bun run lint`, `bun run typecheck` e `GET /api/v1/health` na aplicação local. O teste cobre a versão simulada em app/realtime/webhooks, falha de serviço e relógio divergente. A leitura local retornou `local-unversioned`, como esperado sem variável de deploy.

**Próxima prova:** definir `STAGE_BUILD_VERSION` como identificação imutável do build, implantar em host separado e executar a sonda a partir de observador externo com `--expected-version` igual à revisão implantada. Divergência em qualquer serviço esperado reprova a sonda. Repetir após uma atualização. O ensaio local não fecha a fase 045.
