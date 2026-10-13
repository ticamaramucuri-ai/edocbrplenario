# Etapa 045 — Estado durável dos comandos do telão

**Data:** 13/10/2026 · **Estado:** incremento técnico concluído em SQLite e PostgreSQL descartável; ensaio físico do telão pendente.

## Problema e entrega

Antes, a mesa enviava `display.command` para a outbox, mas o comando não tinha uma representação atual consultável. Se o telão perdesse o evento, a consulta de `public/live` recuperava os fatos da sessão, porém não recuperava congelamento, limpeza ou perfil manual.

`DisplayState` guarda um registro por sessão e Câmara, com `version`, `mode` (`live`, `frozen`, `cleared`) e `manualProfile`. O POST da mesa atualiza o registro e grava o evento na **mesma transação**. A versão do estado acompanha o evento. `GET /api/v1/display/command?sessionId=...` permite que a mesa confira o estado sob RBAC e isolamento por Câmara. `GET /api/v1/public/live` publica somente o estado da sessão selecionada para o telão. O navegador consulta a versão atual após evento, reconexão e a cada dez segundos; versões repetidas ou antigas não substituem a visão mais recente. O controle da mesa também consulta o estado persistido em vez de depender apenas da memória local.

O snapshot local agora registra sessão, modo e versão. Uma troca de Câmara não lê o snapshot anterior. Para uma instalação SQLite existente, aplicar `prisma/sql/029-display-state.sql` após backup; a base local `db/custom.db` foi copiada para um backup ignorado pelo Git antes da aplicação. PostgreSQL usa a migração versionada `0014_display_state.sql`. O copiador SQLite→PostgreSQL confere dinamicamente a lista completa de migrações aplicadas, eliminando o limite fixo de 13.

## Verificação

- `bun run test:display:state`: quatro testes passaram. Exercitam comandos, versão, leitura pública/autenticada, isolamento entre duas Câmaras e rejeição de versão velha no cliente.
- `bun run test:postgres:foundation`: passou, inclusive o novo teste de comandos em PostgreSQL e cópia conciliada de 78 tabelas.
- `bun run typecheck`, `bun run lint` e `bun run build`: passaram.

## Limites e próxima fase

O quadro imutável capturado no servidor foi implementado na [etapa seguinte](045-quadro-congelado-verificavel.md). Ainda falta ensaio em navegador real com dois nós, interrupção de rede e equipamento do plenário.

As integrações Nextcloud e Alfresco permanecem reservadas às fases finais, após o piloto funcional do plenário.
