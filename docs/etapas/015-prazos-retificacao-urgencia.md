# Etapa 015 — Prazos de retificação e urgência

**Data:** 11/10/2026 · **Estado:** concluída localmente para a política de prazo; parâmetros regimentais reais aguardam homologação por cada Câmara.

## Objetivo e entrega

Cada Câmara configura a antecedência mínima da convocação inicial (`minimumNoticeHours`), a antecedência mínima de uma retificação (`minimumAmendmentHours`, de 0 a 720 horas) e os tipos de sessão em que aceita exceção de prazo por urgência (`urgentNoticeExceptionTypes`). Os valores padrão são zero hora e nenhuma exceção, preservando as Câmaras já cadastradas. Publicação e retificação exigem sessão com data futura e aplicam a política vigente no servidor. A janela de retificação continua limitada ao estado `scheduled`, antes do credenciamento.

Quando o prazo é insuficiente, o operador precisa indicar um motivo de exceção com ao menos três caracteres; a Câmara deve ter habilitado o tipo de sessão. Motivo sem prazo descumprido é rejeitado. A convocação pública, o snapshot de política e a auditoria registram o motivo; a revisão anterior não é alterada. A interface de configuração, o diálogo de publicação e a prévia/confirmação de emenda suportam o novo fluxo.

Arquivos: [política](../../src/lib/server/domain.ts), [configuração da Câmara](../../src/modules/settings/index.tsx), [publicação](../../src/app/api/v1/sessions/[id]/transition/route.ts), [retificação](../../src/app/api/v1/sessions/[id]/agenda-amendments/route.ts), [convocação](../../src/lib/server/session-notice.ts) e [teste](../../tests/session-notice-deadlines.test.ts). As regras ficam no JSON de configuração já existente; esta etapa não requer migração de banco.

## Decisões e limites

Exceção é uma autorização **configurada pela Câmara** para um tipo de sessão e justificada em cada ato. O sistema ainda não determina quem, segundo o regimento, pode reconhecer urgência além da permissão de operador de sessão; isso exige homologação institucional e pode demandar aprovação separada. O padrão zero preserva a operação atual, mas não substitui a parametrização antes do uso oficial. Calendário e prova de entrega por canal seguem pendentes. Integrações Nextcloud e Alfresco continuam reservadas ao final do projeto.

## Verificação

`bun run test:session:preparation` passou, inclusive o cenário de prazo insuficiente, tipo sem exceção, urgência justificada e política congelada após edição da Câmara. `bun run typecheck`, `bun run lint` e `bun run build` passaram.

## Próxima etapa

O calendário visual foi entregue na etapa 016. O passo seguinte é persistir alertas antes dos vencimentos, definir o fluxo de aprovação de urgência e parametrizar quórum/maioria por tipo de deliberação. A validação com o regimento de uma Câmara piloto continua necessária.
