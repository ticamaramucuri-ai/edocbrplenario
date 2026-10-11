# Task 23-b — Observabilidade, Exportação Integral e Encerramento Seguro (Fase 16)

Agent: full-stack-developer (subagente Task 23-b) · Status: CONCLUÍDA e verificada

## Entregas (ownership exclusivo respeitado)

| Arquivo | Conteúdo |
|---|---|
| `src/app/api/v1/platform/system-status/route.ts` | GET — health 3003/3004 com `AbortSignal.timeout(2000)` e latencyMs (nunca 500), tamanhos db/custom.db/-wal, filas (outbox + idade do mais antigo; webhooks pending/dead), atividade (tenants, sessões hoje UTC, último audit), runtime (uptime, heap), `alerts[]` critical→warn→info com ação sugerida. RBAC platform.manage. |
| `src/app/api/v1/platform/tenants/[id]/export/route.ts` | POST — exportação integral (24 entidades + aninhados), `settings` parseado, SEM `passwordHash`/`secret`, votos de votação SECRETA com `value: null` (participação mantida), `counts` com 33 métricas, cadeia de auditoria (prevHash→chainHash), `platform.tenant_exported` gravado APÓS montar o payload, `Content-Disposition: attachment; filename="legis-export-{slug}-{AAAAMMDD-HHmm}.json"`. |
| `src/app/api/v1/platform/tenants/[id]/close/route.ts` | POST — zod {justification 10–500, confirm literal 'ENCERRAR'} (422 field errors), 404/409, transação: active=false + revogação de TODAS as AuthSession ativas + assinatura→canceled + `platform.tenant_closed` com justification e before/after. Dados nunca apagados. |
| `src/modules/console/system-tab.tsx` | Aba Sistema: query 30s + "Verificar novamente" (spin), banners de alerta (ícone+severidade+título+ação) e estado positivo, cards serviço/banco/filas/atividade/runtime (badges Operacional/Parado, latência, URL mono, KB/MB, uptime "2d 4h 13m", heap), skeletons, retry, responsivo 1/2/3 colunas. |
| `src/modules/console/index.tsx` (edit) | Tab "Sistema" (Activity) + coluna Ações por tenant: "Exportar dados" (fetch próprio sem JSON.parse → blob → download via URL.createObjectURL + toast com tamanho) e "Encerrar" → AlertDialog com avisos LGPD, Textarea justificativa (contador), Input "ENCERRAR" exato, botão destrutivo desabilitado até ambos válidos; sucesso invalida tenants + toast. |

## Verificação real (registros no worklog.md, Task 23-b)

- system-status: 200 owner (2 serviços ok, 14/10 ms), 403 tenant_admin, 401 sem ator; alerta past_due exibido/ocultado dinamicamente (curl + browser).
- export VN: 200, 112 KB, header correto; sem `passwordHash`/`"secret"`/`scrypt`; counts coerentes; cadeia consistente; votação secreta TEMPORÁRIA provou `value: null` com parliamentarianId preservado (removida após).
- close: 422 (confirm errado / justificativa curta), 404, 403, 200 válido; Marta Lima → 403 TENANT_INACTIVE; duplicado → 409; assinatura → canceled; cadeias VÁLIDAS; Serra Azul REATIVADA (PATCH 200) + assinatura restaurada a trial.
- Browser: aba Sistema completa, dropdown de ações, download real, dialog com 3 estados de validação, encerramento ponta a ponta com invalidação, mobile 390px sem overflow, console limpo.
- `bunx tsc --noEmit` e `bunx eslint`: 0 erros nos 5 arquivos. dev.log sem ⨯.

## Notas para o main

- Dev server caiu 1× durante a task → restart orfanado do runbook aplicado (queda recorrente conhecida).
- Vila Nova NÃO foi encerrada (base principal de demo intacta: active + assinatura active).
- Base demo acumula eventos legítimos das verificações (cadeias válidas); reseed na Task 24 se desejar estado prístino.
- Sugestão de seed: incluir uma votação SECRETA com votos (hoje não há — sigilo só foi demonstrável com dados temporários).
- 409 de tenant já encerrado usa code CONFLICT_VERSION (único 409 genérico disponível; errors.ts fora do ownership).
