# Etapa 012 — Emendas à pauta publicada

**Data:** 11/10/2026 · **Estado:** concluída localmente para inclusão, reordenação e retirada entre publicação e credenciamento.

## Objetivo e entrega

Uma Câmara pode corrigir a Ordem do Dia já publicada sem apagar a versão anterior. O operador com `session.transition` propõe uma inclusão, mudança de posição ou retirada, informa a justificativa, vê a pauta antes/depois e confirma. A API repete todas as validações na confirmação: Câmara e sessão corretas, sessão ainda `scheduled`, versão da sessão, matéria local elegível, item da Ordem do Dia e mínimo de matérias configurado pela Câmara. A confirmação atualiza a pauta, incrementa a versão da sessão, grava a próxima `SessionAgendaRevision` com diferença e justificativa, registra auditoria e emite `agenda.updated` na mesma transação.

O portal mostra a revisão atual, data e motivo. O histórico interno retorna a diferença completa e a política vigente em cada revisão. A ação direta de reordenar continua limitada ao rascunho; retirada/adiamento diretos entre agendamento e credenciamento ficam bloqueados. Os comandos de leitura/discussão só começam após abertura. Os controles do plenário agora refletem esses estados.

O seed demonstrativo foi alinhado ao ciclo de vida: sessões futuras com pauta em elaboração ficam em `draft`, a sessão agendada de demonstração ganha revisão 1, e os contadores anuais registram os números já usados. A base institucional de Mucuri não foi preenchida com dados fictícios.

Arquivos principais: [API de emendas](../../src/app/api/v1/sessions/[id]/agenda-amendments/route.ts), [diálogo de prévia](../../src/modules/sessions/agenda-amendment-dialog.tsx), [painel da pauta](../../src/modules/sessions/agenda-panel.tsx), [painel do plenário](../../src/modules/plenary/agenda-tab.tsx), [migração](../../prisma/sql/012-agenda-amendments.sql) e [teste multi-Câmara](../../tests/agenda-amendments.test.ts).

## Verificação

- Migração ensaiada em cópia: integridade SQLite `ok`, nenhuma FK inválida e `prisma migrate diff` sem diferença. Backup local em `db/custom.db.backup.agenda-amendments-20261011` antes da aplicação.
- `bun run test:session:preparation`: criação/publicação, políticas por Câmara e emendas passaram em banco descartável. Os casos cobrem prévia sem efeito, confirmação, revisão pública, versão antiga, escopo de outra Câmara, matéria estrangeira, mínimo de matérias, reordenação e bloqueio após início do credenciamento.
- Seed completo em banco descartável: integridade SQLite `ok`, duas minutas, uma sessão agendada com pauta publicada, uma revisão e dois contadores anuais.
- `bun run typecheck`, `bun run lint` e `bun run build` são os critérios de saída desta etapa.

## Limites e próxima etapa

As emendas são atos únicos; um pacote com várias alterações coordenadas ainda requer várias revisões. Retirada ou adiamento durante a condução continuam como atos operacionais auditados e não são novas versões da **pauta convocatória**. A configuração de quem pode autorizar emendas, prazos regimentais, notificações formais e convocação depende de modelagem por Câmara. Sessões publicadas antes da revisão inicial não têm histórico reconstruível; a API bloqueia emenda dessas sessões até uma decisão de migração homologada.

**Próxima etapa:** convocação formal com comprovante de divulgação e regras de prazo por Câmara; depois políticas regimentais de quórum, maioria e elegibilidade por tipo de sessão/votação. Integrações Nextcloud/Alfresco seguem no final do projeto.
