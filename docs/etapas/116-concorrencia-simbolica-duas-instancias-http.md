# 116 — Concorrência simbólica entre duas instâncias HTTP

**Estado:** L1/L2 executada em build local e PostgreSQL descartável · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Verificar a proteção contra propostas simbólicas concorrentes entre dois processos HTTP independentes apontados para a mesma base PostgreSQL.

## Ambiente e comando

- `bun run test:postgres:foundation` inicia um PostgreSQL descartável, aplica as migrações e gera cliente Prisma PostgreSQL.
- O runner compila a aplicação standalone em diretório temporário e sobe duas instâncias em portas distintas, ambas conectadas ao mesmo banco.
- Câmara, sessão, votação, parlamentares e operadores são fixtures sintéticas. Cada instância autentica um operador por senha/cookie de sessão.
- O runner interrompe os dois servidores, remove fixtures, container e arquivos temporários e restaura o cliente Prisma SQLite e arquivos de configuração do projeto.

## Evidência

As duas instâncias receberam simultaneamente propostas diferentes para a votação e versão 7. Resultado observado: instâncias HTTP distintas (`distinctProcesses: true`), respostas `[200, 409]`, uma revisão persistida com uma das contagens completas, versão avançada apenas para 8 e um evento de auditoria. O comando completo terminou com código zero; depois dele, a suíte oficial SQLite passou novamente (6 testes/58 assertions), confirmando a restauração do cliente local. Container e diretório temporário do runner foram verificados como removidos.

## Limites

O ensaio original cobre a concorrência de duas propostas em dois processos HTTP. As disputas de confirmação simultânea e proposta contra fechamento foram acrescentadas na [etapa 117](117-corridas-confirmacao-e-encerramento-simbolico.md). Carga prolongada, partição de rede e infraestrutura institucional seguem pendentes.
