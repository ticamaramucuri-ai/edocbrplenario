# Etapa 045 — Quadro congelado verificável

**Data:** 13/10/2026 · **Estado:** incremento técnico concluído em SQLite local e PostgreSQL descartável; validação em equipamento e rede do plenário pendente.

## Problema e entrega

O estado versionado da etapa anterior restaurava o modo `frozen`, mas uma tela nova reconstruía o conteúdo com dados atuais. O comando `freeze` agora monta a mesma visão pública usada por `GET /public/live`, dentro da transação que grava o estado e o evento. O quadro serializado fica em `DisplayState.frozenFrameJson`, com SHA-256, horário de captura e limite de 1 MiB. O comando é recusado quando a sessão indicada não é a que o portal público está exibindo. Um comando posterior de perfil, limpeza ou liberação apaga o quadro antigo.

`GET /api/v1/public/display-frame?tenant=...&sessionId=...&version=...` entrega o quadro somente se Câmara, sessão, versão e modo ainda corresponderem ao estado atual. Recalcula o hash antes de responder e usa `Cache-Control: no-store`. O telão busca essa rota ao adotar uma nova versão congelada, inclusive após reiniciar em um navegador sem snapshot local. `public/live` continua entregando apenas o hash/metadados, sem repetir o quadro inteiro a cada consulta do portal.

A montagem da visão pública foi extraída para `src/lib/server/public-live.ts`, usada tanto pela rota quanto pela captura. As migrações são `prisma/postgres/migrations/0015_display_frozen_frame.sql` e `prisma/sql/030-display-frozen-frame.sql`. A base SQLite local recebeu a segunda após backup ignorado pelo Git; novas bases usam o esquema Prisma.

## Verificação

- `bun run test:display:state`: quatro testes passaram, incluindo imutabilidade após mudança visível na sessão, isolamento entre Câmaras, rejeição de sessão não exibida e recusa de conteúdo adulterado.
- `bun run test:postgres:foundation`: migrações 0001–0015, cópia conciliada de 78 tabelas, backup/restauração e teste funcional do quadro em PostgreSQL passaram.
- `bun run typecheck`, `bun run lint` e `bun run build`: passaram.

## Limites e próxima fase

O quadro imutável registra a **visão pública de dados**, não uma imagem ou vídeo do sinal audiovisual. O relógio animado do telão continua avançando; a representação de fatos da sessão permanece fixa. A leitura da visão canônica usa várias consultas na transação; um ensaio concorrente entre nós ainda deve medir a consistência sob atualizações simultâneas. O limite de 1 MiB evita retenção descontrolada no banco; é preciso medir tamanho e retenção com pautas oficiais. Ao retirar um conteúdo público, a operação deve também liberar ou limpar um telão congelado para não manter material antigo visível. Falta ensaio físico com duas telas, perda de rede, reconexão e observador externo.

Nextcloud e Alfresco permanecem nas fases finais após o piloto do plenário.
