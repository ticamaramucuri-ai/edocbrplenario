# Guia do Importador de Migração — Legis SaaS

Importador auditado do **PainelDeskLegis 8.1** (legado Java/Swing + HSQLDB) para o
Legis SaaS. Implementa o pipeline obrigatório do prompt mestre (§14).

---

## 1. Fonte de dados

- **Demonstração (sandbox):** `upload/legacy/` — export sintético gerado por
  `scripts/generate-legacy-export.ts`: `manifest.json` + CSVs (`parlamentares`,
  `proposicoes`, `sessoes`, `presencas`, `votacoes`, `votos`) com dados fictícios
  2021–2024 e **problemas propositais**: 3 registros órfãos (presenças/votos com fk
  inexistente), 1 votação órfã, 1 duplicidade e 1 voto `NULL` — para exercitar `validate`.
- **Base real (produção):** substituir o leitor em `src/lib/server/migration/legacy-source.ts`
  (mesma interface de tabelas). O restante do pipeline não muda.

## 2. Pipeline (8 estágios)

Acessível em `Administração → Migração de Dados` (perfis: Administrador da Câmara,
Administração Legislativa, Operação da Plataforma) ou via API.

| # | Estágio | O que faz | Grava? |
|---|---|---|---|
| 1 | **Inspecionar** | Cria a execução; identifica fonte/versão, tabelas e contagens | run + issues info |
| 2 | **Validar** | Órfãos, duplicidades, datas inválidos, domínios legados desconhecidos | issues warn/error |
| 3 | **Planejar** | Mapas legado→novo (situações, cargos da mesa, modos de votação) sem gravar | stats |
| 4 | **Simular** | Transformação em memória; detecta nomes coincidentes com cadastro atual | stats + warns |
| 5 | **Importar** | Grava em lotes transacionais; **retomável e idempotente** (pula mappings existentes) | dados + mappings |
| 6 | **Reconciliar** | Contagens por tabela fonte×destino, amostras e checksum agregado | stats (divergências) |
| 7 | **Relatório** | Consolidação final com issues por severidade e amostras; encerra a execução | report |
| 8 | **Rollback** | Remove EXCLUSIVAMENTE os dados desta execução (pelos mappings) | deleções auditadas |

### Mapas de transformação (principais)

| Legado (8.1) | Novo (Legis SaaS) |
|---|---|
| `EM_TRAMITACAO / APROVADA / REJEITADA / ARQUIVADA / PAUTA` | `em_tramitacao / aprovado / rejeitado / arquivado / incluida_pauta` |
| Cargos da mesa (`PRESIDENTE`, `VICE`, …) | `BoardPosition` com vigência da legislatura importada |
| `SIMBOLICA / NOMINAL / SECRETA` | `simbolico / nominal / secreto` |
| Parlamentares | Cadastro **inativo** + `Mandate` na legislatura anterior (2021–2024, criada se não existir) |
| IDs legados | `MigrationMapping` (sourceTable+sourceId → targetModel+targetId); **nunca** PK nova |

## 3. Regras de integridade

- **Nada é deduzido:** voto/presença/resultado ausente vira issue `warn` para homologação
  humana (ex.: voto `NULL` legado → "voto não registrado — homologar com a Câmara").
- **Conflitos nunca silenciosos:** nome coincidente com vereador atual → warn
  "importar como mandato anterior" (a cargo do homologador).
- **Idempotência:** re-executar `import` (na mesma run ou em run nova) não duplica —
  mappings existentes são pulados.
- **Isolamento:** import SEMPRE no tenant do ator autenticado.

## 4. Homologação e rollback

- **Homologar** (`POST /api/v1/migration/runs/:id/homologate`): exige relatório concluído,
  digitação literal `HOMOLOGAR` e é **irreversível** — bloqueia o rollback para sempre e
  torna os dados oficiais. Auditada com justificativa.
- **Rollback**: remove apenas dados criados pela execução (ordem inversa:
  votos → votações → presenças → pauta/sessões → matérias → mandatos → parlamentares →
  legislatura). Auditoria `migration.rollback`.

## 5. Verificação do receptor (divergências)

O estágio `reconcile` compara:
1. contagens por tabela (fonte × destino);
2. amostras aleatórias de registros;
3. checksum agregado (SHA-256 dos IDs ordenados).

Resultado esperado em import limpa: `divergencias: 0`. Divergências geram issues `error`
— investigar antes de homologar.

## 6. Roteiro rápido (demonstração)

```bash
# 1. (opcional) regenerar a fonte sintética
bun scripts/generate-legacy-export.ts

# 2. Via UI: Administração → Migração de Dados → Inspecionar → Validar → … → Relatório
#    (ou via API)
TA=<id do tenant_admin>   # ver runbook §1
curl -s -X POST localhost:3000/api/v1/migration/run -H "x-actor-id: $TA" \
  -H 'Content-Type: application/json' -d '{"stage":"inspect"}'
# … encadear estágios com {"stage":"validate","runId":"<id>"} …
```

## 7. Divergências conhecidas entre legado e novo sistema

Registradas como decisões (ADR-008) e issues quando aplicável:
- Legislatura anterior é materializada como registro próprio (legado não a tinha);
- Sessões legadas são importadas já `closed` com snapshots de quórum recalculados;
- Situações legadas sem equivalente (ex.: `PAUTA` genérica) mapeiam para
  `incluida_pauta` — homologar caso a caso.
