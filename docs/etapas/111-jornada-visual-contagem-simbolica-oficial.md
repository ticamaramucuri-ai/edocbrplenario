# 111 — Jornada visual da contagem simbólica oficial

**Estado:** L1 parcial executada em build e SQLite descartáveis · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Percorrer a conferência oficial de uma votação simbólica customizada pela interface da Mesa: proposta da Secretaria, apresentação das chaves/contagens, confirmação por outra identidade e fechamento usando exclusivamente a revisão confirmada.

## Ambiente e fixture

- Linux local, build standalone e Playwright Chromium headless.
- Comando: `bun run build` seguido de `bun run test:pwa:plenary-browser`.
- Banco SQLite temporário criado e destruído pelo runner.
- O script define políticas de votação sintéticas para os seis tipos de matéria, consulta a prontidão e aprova a configuração resultante pela API oficial. Em seguida cria a sessão oficial via endpoint normal; não marca a sessão diretamente no banco nem remove as proteções da API.
- Secretaria: Marcos Vieira (`session_operator`). Presidência: Roberto Nogueira (`presiding_officer`).

## Evidência observada

Na Mesa, a votação simbólica customizada abriu com as opções “A favor” e “Contra”. Marcos preencheu 2 e 1 no diálogo “Encerrar votação simbólica” e enviou a contagem. A tela exibiu que aguardava conferência independente e os valores por rótulo. Roberto, em outra sessão de navegador autenticada, confirmou pela ação “Confirmar como segunda pessoa” e a interface exibiu sua identidade como confirmadora. A Presidência encerrou pela interface sem reenviar os números.

O endpoint de revisões confirmou proposta e identidade; o detalhe final da sessão confirmou `aprovado`, `{ a_favor: 2, contra: 1 }` e 10 presentes que não foram contados como votos. O mesmo runner preservou as etapas anteriores de check-in/voto PWA, retry idempotente após resposta perdida e recibo visual. Resultado `ok: true`, `synthetic: true`, `closedViaMesa: true`.

## Limites

Uma única contagem nominalmente classificada como simbólica, com regra de maioria simples e duas opções. Não cobre revisão concorrente, empate simbólico oficial, regra de maioria absoluta/unanimidade, valores inválidos na janela da Mesa, recuperação de falha de rede durante a conferência nem todas as combinações de papéis. A configuração aprovada é sintética e descartável; não representa aprovação regimental de uma Câmara real.
