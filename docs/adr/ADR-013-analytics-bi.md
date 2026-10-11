# ADR-013 — Analytics/BI legislativo como camada somente-leitura

**Status:** Aceito · **Data:** Fase 12 · **Contexto:** sandbox

## Contexto

Toda a inteligência operacional do sistema é transacional (mesa do plenário, tramitação).
Faltava a visão agregada de produtividade — presenças, produção legislativa, tramitação,
disciplina partidária — para presidência, imprensa e controle interno. Volumes do sandbox
são pequenos, mas as agregações tocam domínios sensíveis (voto secreto, isolamento
multi-tenant).

## Decisão

1. **Uma única rota agregada** (`GET /api/v1/analytics/overview?year=`, permissão
   `analytics.read` para todos os papéis) que responde um payload composto pronto para
   visualização: KPIs, ranking de presenças, sessões por mês, matérias por
   status/tipo/autores, resultados de votação, coesão por partido e fluxo de tramitação.
2. **Somente leitura:** a rota não abre transação e não escreve NADA no banco (nem outbox
   nem auditoria — leitura não é evento de negócio). Cálculo 100% em memória sobre
   `findMany` filtrados por tenant.
3. **Semântica replicada, não reinventada:** presença usa a MESMA regra do plenário
   (último `AttendanceEvent` por parlamentar/sessão; só parlamentares ativos); sessão
   realizada = com abertura registrada; aprovação de matéria = status `aprovado`
   (`arquivado` não conta).
4. **Voto secreto é inviolável:** a coesão partidária usa EXCLUSIVAMENTE votações
   nominais encerradas (modo `secret` excluído do cálculo) e ignora votos sem valor.
   Maioria do partido por votação é estrita (empate = partido sem posição).
5. **Isolamento por escopo do ator:** agregações sempre do tenant resolvido
   (`resolveTenantScope`); `platform_owner` pode inspecionar outro tenant via `?tenant=`.
6. Frontend consome `recharts` através do componente Chart do shadcn (tema consistente,
   cores institucionais) com exportação CSV client-side do ranking.

## Consequências

- (+) Zero risco de escrita acidental; payload único facilita cache futuro; sigilo do voto
  e isolamento garantidos por construção.
- (−) Recalcula agregações a cada chamada (sem cache) — aceitável no sandbox; janelas
  muito grandes exigiriam job pré-agregado em produção.
- (→) Produção: materialized views por dia/período + cache por tenant; ampliar coesão
  para votações simbólicas registradas nominalmente quando houver.
