# Etapa 088 — Tarefas, versões e desfechos

**Fase:** L1, fluxo legislativo e pós-aprovação  
**Data:** 10/11/2026  
**Ambiente:** Linux, Bun 1.4.2, SQLite descartável; `LEGIS_DEMO_MODE=true`; nenhuma rede externa

## Incremento e execução

Adicionei `tests/matter-deadlines-outcomes.test.ts`, `scripts/test-matter-deadlines-outcomes.sh` e `bun run test:matters:workflow`.

```sh
bun run test:matters:workflow
```

**Resultado:** 1 teste aprovado, 25 assertions, zero falhas. O fluxo conferiu versão de texto sequencial, recusa de papel não autorizado e texto inválido; aprovação por tramitação; veto parcial com justificativa e prazo; geração transacional da tarefa de apreciação e do andamento; rejeição de desfecho duplicado; sanção após veto parcial; bloqueio de veto depois de matéria sancionada; criação de tarefa por operador autorizado; vínculo indevido a Câmara alheia recusado; filtro de prazo vencido; cancelamento justificado e recusa de alteração de tarefa terminal; auditoria e outbox.

## Limites

O fluxo é coberto por handlers de API e SQLite temporário, não pela UI. Busca, relação entre matérias, modelos de documentos e parecer técnico como função separada seguem pendentes. A regra de prazo foi testada com fixture vencida sintética; não equivale a validação de calendário/regimento de uma Câmara específica.
