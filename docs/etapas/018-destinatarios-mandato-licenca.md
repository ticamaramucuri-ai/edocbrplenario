# Etapa 018 — Destinatários por mandato e licença

**Data:** 11/10/2026 · **Estado:** concluída localmente para seleção opcional e prévia; homologação regimental ainda necessária.

## Objetivo e entrega

Cada Câmara escolhe `noticeRecipientPolicy`: `active` (padrão anterior, todos os parlamentares ativos) ou `mandate_and_leave`. Na segunda opção, a publicação ou retificação da convocação seleciona parlamentares ativos com mandato que cubra a **data civil da sessão no fuso da Câmara**, exclui titulares com licença/afastamento vigente nesse dia e inclui o suplente ativo explicitamente indicado no afastamento de um titular com mandato. O fim do mandato ou afastamento vale até o fim da data registrada. O cadastro `suplencia` isolado não substitui o vínculo explícito do titular afastado. A seleção é restrita ao tenant, sem duplicar pessoas. Sem elegíveis, a publicação é rejeitada e a transação é desfeita.

O painel da pauta mostra uma prévia dos nomes que seriam incluídos na próxima emissão. Ela é consultada por operador autorizado e pode mudar até a publicação. A lista efetivamente emitida continua congelada por revisão e hash; alterações posteriores de mandato, licença ou política não reescrevem ciências anteriores. O critério adotado integra o snapshot da política na convocação.

Arquivos principais: [seleção](../../src/lib/server/session-notice-recipients.ts), [configuração](../../src/modules/settings/index.tsx), [prévia](../../src/app/api/v1/sessions/[id]/notice-recipient-preview/route.ts), [painel](../../src/modules/sessions/agenda-panel.tsx) e [teste](../../tests/session-notice-recipient-policy.test.ts). Não há migração de banco: a política ocupa o JSON de configuração já existente.

## Verificação

`bun run test:session:preparation` cobre política padrão, data local, mandato futuro, suplente, licença encerrada, snapshot imutável, prévia autorizada e isolamento entre Câmaras. `bun run typecheck`, `bun run lint` e `bun run build` completam a verificação. Nenhum dado de Mucuri é modificado; a nova política fica desativada até escolha explícita da Câmara.

## Limites e próxima etapa

O sistema não infere posse do suplente sem indicação no afastamento, nem comprova validade jurídica da lista ou entrega da convocação. A Câmara piloto precisa conferir o regimento e os cadastros antes de ativar a opção. A estrutura atual não modela todas as hipóteses regimentais de substituição. Próxima etapa: parametrizar quórum e maioria por tipo de deliberação, com testes de empate, abstenção e impedimento. Nextcloud e Alfresco continuam para o final do projeto.
