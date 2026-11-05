# Etapa 053b — Ciclo de eleição da Mesa Diretora

**Data:** 05/11/2026. **Estado:** incremento funcional local concluído; ato institucional e piloto pendentes.

## Entregue

- O formulário de Mesa permite registrar um cargo em exercício ou uma eleição futura, com data prevista de posse, fim do período opcional e referência do ato. A eleição pode coexistir com o ocupante atual e não assume automaticamente.
- A tabela mostra **Eleita · posse pendente** ou **Eleição cancelada**. Administradores com permissão `structure.write` podem confirmar posse ou cancelar eleição; ambos exigem referência do ato e deixam evento de auditoria. Posições canceladas preservam histórico e liberam o cadastro de nova eleição no mesmo período.
- A confirmação rejeita data futura e sobreposição com outra posição confirmada. A atualização de estado é condicional dentro da transação, impedindo dupla confirmação concorrente. Ao confirmar, o cargo exibido dos parlamentares é atualizado.
- Datas civis informadas na interface são convertidas para UTC usando o fuso da Câmara, inclusive o último instante do dia final.

## Verificação

- `bash scripts/test-legislature-optional-number.sh`: 2 testes, 25 verificações passaram. Cobrem eleição coexistindo com Mesa vigente, confirmação prematura rejeitada, posse confirmada, cancelamento, nova eleição no mesmo período, referência auditada e fusos Bahia/Manaus.
- `bun run typecheck`, ESLint dos arquivos alterados, `bun run build` e `bun run test:official-configuration`: passaram.
- Nenhuma posição de Mucuri mudou nesta etapa: 4 posições `confirmed` (2025–2026) e 4 `elected` (2027–2028). A posse de 2027 continua pendente.

## Próxima etapa

Receber ato real de posse e conferência da Câmara quando ocorrer. Para o piloto, ainda faltam responsáveis nominais, regras regimentais aprovadas, host separado e canal social institucional. A fase de integração Nextcloud/Alfresco permanece posterior aos fluxos do Plenário.
