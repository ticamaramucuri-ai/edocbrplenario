# 049 — Conferência deliberativa independente

**Data:** 05/11/2026. **Estado:** ensaio local fictício concluído; sem aceite regimental ou institucional.

## Objetivo e método

Conferir o resultado fora do motor de votação. `tests/deliberation-independent.test.ts` declara os votos e a base esperada em um pequeno “livro de papel”, apura por função isolada que não importa `domain.ts` nem `voting-service.ts` e confronta o resultado com o banco, a ata estruturada e a consulta pública. Um banco SQLite temporário é criado e apagado por `scripts/test-deliberation-independent.sh`.

## Casos exercitados

| Caso fictício | Base e votos esperados | Resultado de papel | Conferência |
|---|---|---|---|
| Licença e suplente, impedimento mantém base | 4 cadeiras; 3 presentes elegíveis; 2 sim, 1 não | Rejeitado por maioria absoluta | Titular e impedido recusados; snapshot, resultado persistido, ata e portal coincidem |
| Mesmos votos, impedimento reduz base | 3 cadeiras; 3 presentes elegíveis; 2 sim, 1 não | Aprovado por maioria absoluta | Mudança de política por Câmara altera só a base da nova votação |
| Simbólica oficial com empate | 4 presentes; 2 sim, 2 não | Empate | Proposta da secretaria, confirmação por outra identidade, banco, ata e portal coincidem |
| Anulação do empate | Resultado anterior preservado em auditoria | Anulado, sem contagem vigente | Banco, ata e portal removem a contagem ativa |
| Outra Câmara | Ator externo e slug alheio | Acesso negado | Comandos 403, leitura pública 404 e nenhuma auditoria do ato no outro tenant |

**Provas executadas:** `bun run test:deliberation:independent` passou (2 testes, 51 asserções); `bun run typecheck` passou. O comando entrou na CI da aplicação. O ensaio não usa composição ou política de Mucuri e não decide regra oficial. Os cenários de empate nominal, presença variável durante a votação, múltiplas instâncias PostgreSQL e conferência humana da ata permanecem para a matriz e homologação institucional.

**Próximo incremento:** transmissão local com dois destinos simulados, perda/retorno isolada, gravação/replay e atividade legislativa simultânea; depois pacote de homologação. A aprovação das regras por Câmara segue na fase 046/049.
