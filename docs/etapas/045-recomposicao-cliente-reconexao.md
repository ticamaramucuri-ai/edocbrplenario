# Etapa 045 — Recomposição do cliente após reconexão

**Data:** 13/10/2026 · **Estado:** incremento técnico concluído localmente; comandos manuais do telão ainda exigem estado durável.

## Objetivo e entrega

O fanout em dois nós da etapa anterior demonstrou distribuição de eventos, mas um navegador desconectado pode perder uma mudança enquanto o stream e a outbox já a consideram publicada. A tela interna agora invalida e relê as consultas ativas após a confirmação de assinatura da sala interna. O telão faz o mesmo com `public/live` após reassinar sua sala pública, além de manter a consulta periódica de 10 segundos.

O snapshot local do telão passou a usar a identidade da Câmara na chave e no conteúdo. A consulta `public/live` usa o slug no identificador de cache; durante uma troca de Câmara, os dados retidos e o perfil manual só são exibidos para o mesmo tenant. O snapshot antigo, sem escopo, deixa de ser lido.

Arquivos principais: `src/hooks/use-realtime.ts`, `src/modules/display/index.tsx`, `src/modules/display/snapshot.ts` e `tests/display-snapshot.test.ts`.

## Verificação

- `bun test tests/display-snapshot.test.ts`: 2 testes passaram, incluindo isolamento entre duas Câmaras e rejeição de snapshot incompatível.
- `bun run typecheck`: passou.
- `bun run lint`: passou.
- `bun run build`: passou.

Esta verificação cobre a lógica local e a compilação. Ainda falta um ensaio de navegador com desconexão durante uma sessão em dois nós, observando a reconsulta real da API e a atualização visual após o retorno.

## Limites e próxima etapa

`display.command` ainda é um comando efêmero no navegador. Se a mesa congelar, limpar ou selecionar um perfil enquanto o telão estiver desconectado, o retorno da consulta pública reconstrói os fatos da sessão, mas não recupera a intenção visual manual que foi perdida. A próxima etapa técnica é persistir o estado de apresentação por Câmara/sessão, expô-lo ao telão em uma API autorizada e aplicar versões monotônicas para que comando antigo não sobrescreva o novo. Em seguida, repetir a falha entre nós e verificar tela interna, telão e votos com observação externa.

Não há mudança de integração com Nextcloud ou Alfresco; seguem reservados às fases 054–056 após o piloto do plenário.
