# 110 — Contagem simbólica oficial com opções customizadas

**Estado:** L1 executada em SQLite descartável · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Validar a trilha da contagem simbólica oficial quando as opções da votação são customizadas: chaves exatas, limite pelo comparecimento, revisão proposta, segunda identidade, fechamento usando a proposta confirmada e consulta do histórico.

## Execução

Comando: `bun run test:plenary:official-increments`. O runner prepara SQLite temporário e executa presença oficial e contagem simbólica. O novo cenário cria uma sessão oficial, votação simbólica aberta com as opções `a_favor`/`contra`, três presentes e duas identidades distintas (Secretaria e Presidência).

## Resultado

Resultado da suíte: **4 pass, 0 fail, 46 expect calls**. Propostas com chave ausente ou soma maior que os presentes retornaram 422 sem criar revisão. A contagem `{ a_favor: 2, contra: 1 }` foi proposta pela Secretaria, confirmada pela Presidência e fechada sem reenviar contagem. O resultado persistiu como aprovado, com três presentes, zero sem voto e as contagens customizadas. O endpoint de revisões devolveu a contagem e o nome da Presidência que confirmou.

## Limites

O caso exercita contagem simbólica oficial nominalmente classificada como oficial, mas não empate customizado nesse protocolo, modos de quorum diferentes, tentativa de substituir revisão confirmada, concorrência entre conferentes nem os controles visuais da janela de conferência na Mesa. Regras específicas dependem de configuração e aceite de cada Câmara.
