# ADR-016 — Central de Ajuda e documentação in-app versionada com o código

**Status:** Aceito · **Data:** Fase 15 · **Contexto:** sandbox

## Contexto

Toda a documentação do produto (manual do usuário, changelog, ADRs, contrato da API) vivia
só em arquivos do repositório — invisível para quem usa o sistema. O prompt mestre exige
onboarding e suporte de primeiro nível dentro do produto (§7.1) e um pacote de
documentação acompanhando o sistema. Sem a central, cada novo usuário dependia de alguém
explicando onde clicar.

## Decisão

1. **Conteúdo versionado com o código**: a fonte única é `src/lib/server/help-content.ts`
   — NENHUM modelo Prisma, nenhum banco. A central é documentação VIVA que sai no mesmo
   commit do release que documenta; o checklist de release passa a incluir uma revisão do
   `help-content.ts`.
2. **Servida por API autenticada** (`GET /api/v1/help`) para QUALQUER papel autenticado,
   inclusive `platform_owner` sem tenant — a rota não usa `resolveTenantScope` (a ajuda é
   global, o conteúdo não tem dado de tenant). O frontend não hardcodeia nada: guias,
   glossário (26 termos), FAQ (12), atalhos (5), changelog 0.1.0→0.10.0 e o "Sobre" com a
   stack e o índice dos documentos do produto vêm todos da resposta.
3. **Guias por papel** (um para cada um dos 7 papéis) com passos numerados e chips de
   módulos clicáveis: o guia ORIENTA a navegação, mas o RBAC real continua server-side —
   a central nunca é vetor de permissão, só de descoberta.
4. **Busca local no cliente**: filtro unificado sobre guias + glossário + FAQ com
   normalização NFD (sem acentos/caixa — "quorum" acha "Quórum") e contagem por aba.
   Nada de endpoint de busca: o payload completo já está no cliente.
5. **Módulo Central de Ajuda** no grupo novo "Ajuda", visível a todos os papéis, com 6
   abas (Primeiros passos com seletor de papel, Glossário, Perguntas frequentes, Atalhos,
   Novidades, Sobre).

## Consequências

- (+) Zero drift de deploy (conteúdo e código nunca divergem — são o mesmo artefato); sem
  migration/seed; conteúdo testável junto do resto do contrato.
- (−) Pode defasar se um release esquecer de atualizar `help-content.ts` — mitigado ao
  incluir a revisão no checklist de release (aceito: prefiro defasável a invisível).
- (→) Produção: documentação parametrizada por tenant/plano (planos com módulos distintos
  exibem guias distintos), tour guiado passo a passo sobre a UI e métricas de busca sem
  resultado para guiar o que escrever a seguir.
