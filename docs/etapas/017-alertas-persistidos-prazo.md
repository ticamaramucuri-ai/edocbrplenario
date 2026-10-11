# Etapa 017 — Alertas persistidos de prazo

**Data:** 11/10/2026 · **Estado:** concluída localmente para notificações internas. Entrega por canais externos ainda não integra esta etapa.

## Objetivo e entrega

Cada Câmara define `noticeAlertLeadHours` entre 1 e 168 horas (padrão 24). Uma varredura do agendador encontra sessões futuras em rascunho ou agendadas cujo prazo de convocação inicial ou retificação se aproxima ou venceu. Cria notificações internas para `tenant_admin` e `session_operator`, com horário no fuso institucional, link ao módulo Sessões e evento interno `notification.new`. A chave única por Câmara, sessão, fase, data marcada, vencimento, estado e papel impede avisos repetidos. Uma remarcação cria um novo alerta sem apagar o anterior; depois do vencimento, um alerta distinto indica atraso.

O calendário e a varredura usam o mesmo cálculo. Sessão sem pauta publicada é tratada como pendência inicial mesmo se uma base legada contiver `status=scheduled` incoerente. O agendador existente ganhou o kind `notice.deadline_alerts` (intervalo padrão de cinco minutos), acionável também pela execução manual da plataforma. O caminho do banco do mini-serviço agora usa `SCHEDULER_DB_PATH` ou o banco local do projeto, sem caminho antigo fixo.

Arquivos principais: [cálculo](../../src/lib/server/notice-deadline.ts), [varredura](../../src/lib/server/notice-deadline-alerts.ts), [agendador](../../mini-services/scheduler/index.ts), [configuração](../../src/modules/settings/index.tsx), [migração](../../prisma/sql/017-notice-deadline-alerts.sql) e [teste](../../tests/session-notice-alerts.test.ts).

## Migração e reparo local

A migração acrescenta `Notification.dedupeKey` opcional com unicidade por Câmara e cadastra o job para instalações existentes. Notificações anteriores continuam sem chave. Foi ensaiada em cópia: integridade SQLite OK, nenhuma FK inválida, sem diferença no schema Prisma. A base local foi respaldada em `db/custom.db.backup.notice-alerts-20261011` e recebeu a migração com as mesmas verificações.

A base demonstrativa local tinha duas sessões fictícias com `status=scheduled`, pauta não publicada, nenhuma revisão e nenhuma presença. O seed atual já as define como `draft`; a correção local alterou somente essas duas linhas (Vila Nova nº 3 e Serra Azul nº 2), após backup. Nenhum registro de Mucuri foi modificado.

## Verificação

`bun run test:session:preparation`, `bun run typecheck`, `bun run lint` e `bun run build` passaram. Os testes cobrem repetição da varredura, separação entre Câmaras e nova notificação após remarcação. O kind do scheduler foi executado manualmente por HTTP usando banco descartável, com resposta `status=ok`.

## Limites e próxima etapa

Os alertas dependem do mini-serviço scheduler estar ativo; o app sozinho não executa jobs periódicos. A central de notificações já faz polling, então os avisos aparecem mesmo sem socket.io, mas o indicador de tempo real continua desconectado se o gateway e o serviço realtime não estiverem ativos. Avisos históricos não são removidos quando a sessão é remarcada; o texto registra o prazo da época. O critério atual de destinatários da convocação continua `active=true`, ainda sem mandato/licença. Próximos passos: homologar esse critério e a aprovação de urgência com regimento piloto; depois parametrizar quórum e maioria por tipo de deliberação. Nextcloud e Alfresco permanecem para o final do projeto.
