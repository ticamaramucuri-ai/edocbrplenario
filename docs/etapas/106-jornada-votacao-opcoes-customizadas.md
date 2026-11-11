# 106 — Jornada local de votação com opções regimentais customizadas

**Estado:** L1 parcial executada em build e banco SQLite descartáveis · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Requisito e objetivo

Verificar a cadeia de votação com opções regimentais definidas pela Mesa: configuração em pauta, abertura, apresentação dos rótulos no PWA, persistência da chave, deduplicação após confirmação perdida, recibo e contagem final.

## Implementação e execução

O diálogo “Configurar votação” em `src/modules/plenary/agenda-tab.tsx` agora limita sua altura a 90% da viewport e permite rolagem interna. A jornada em `scripts/local-pwa-vote-browser.mjs` configura pela UI “A favor” e “Contra”, confirma as chaves `a_favor` e `contra` na sessão persistida, abre a votação pela aba Votação da Mesa e percorre o voto nominal no PWA a 390×844.

Comandos executados: `bun run build` e `bun run test:pwa:plenary-browser`. Ambiente Linux, build standalone, Chromium headless e banco SQLite temporário com seed sintético.

## Evidência observada

Resultado do runner: `ok: true`, `synthetic: true`. O PWA apresentou “A favor”; o voto foi persistido como `a_favor`. A primeira resposta HTTP 200 foi descartada no navegador e a retentativa repetiu o mesmo `commandId`; houve exatamente um voto. Após encerramento, o recibo nominal apareceu no PWA e a apuração guardou `resultCounts.custom.a_favor = 1`. A viewport móvel permaneceu sem overflow horizontal (390 px de documento para 390 px de viewport).

## Limites e próximos casos

A contagem foi conferida para uma opção e um voto; não cobre empate, distribuição de votos entre várias opções, restrições de chaves/rótulos pela UI, modos simbólico/secreto nem falhas 4xx/429/5xx. O voto secreto oficial permanece bloqueado pelas regras do produto. A matriz completa de autorizações e as regras regimentais de cada Câmara continuam pendentes de configuração/aceite institucional.
