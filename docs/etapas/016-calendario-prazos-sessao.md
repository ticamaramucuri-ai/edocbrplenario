# Etapa 016 — Calendário de prazos da sessão

**Data:** 11/10/2026 · **Estado:** concluída localmente para acompanhamento visual. Não há envio automático de alertas.

## Objetivo e entrega

A Mesa consulta as próximas 50 sessões futuras em rascunho ou agendadas da sua Câmara. Para cada rascunho, o sistema calcula o limite de publicação pela antecedência mínima da convocação inicial; para sessão agendada, calcula o limite de retificação. A API devolve horário da sessão, vencimento, fase, prazo exigido e se o tipo admite exceção. A página Sessões mostra até seis vencimentos próximos, com estados **dentro do prazo**, **vence em até 24 horas** e **prazo vencido**, atualizados a cada minuto. A apresentação usa o fuso institucional da Câmara.

O cálculo usa instantes UTC persistidos e aplica o fuso apenas na exibição; evita deslocar o vencimento por diferença de timezone do navegador. O escopo vem do ator autenticado e a rota exige permissão de transição da sessão.

Arquivos: [API](../../src/app/api/v1/sessions/notice-calendar/route.ts), [painel](../../src/modules/sessions/index.tsx) e [teste](../../tests/session-notice-calendar.test.ts). Não há alteração de schema nem migração.

## Verificação

`bun run test:session:preparation` passou, incluindo teste de cálculo por fase, estado vencido, tipo com exceção, fuso e isolamento entre Câmaras. `bun run typecheck`, `bun run lint` e `bun run build` passaram.

## Limites e próxima etapa

O painel é somente leitura e mostra seis sessões; a API retorna até 50. Alertas operacionais persistidos foram entregues na etapa 017. Mudanças de política afetam o cálculo de prazos futuros, mas não alteram o snapshot de convocação já emitida. Seguem pendentes os critérios de destinatários segundo mandato/licença e a homologação das regras de urgência com uma Câmara piloto. Em seguida, parametrizar quórum e maioria por tipo de deliberação. Integrações Nextcloud e Alfresco continuam reservadas ao fim do projeto.
