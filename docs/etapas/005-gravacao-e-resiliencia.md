# Etapa 005 — Gravação e resiliência operacional

**Data:** 10/10/2026 · **Estado:** em andamento. Primeira fatia: visibilidade do catálogo de gravação.

## Entrega

A aba Transmissão consulta a Control API do MediaMTX para informar se a
gravação está configurada, quantos segmentos pertencem ao caminho exato da
sessão e quando o último foi iniciado. A resposta é restrita a `media.read`
e não expõe caminhos de arquivo, chaves ou URLs de ingestão. A interface
avisa que a existência de segmentos não comprova integridade. O adaptador e
os testes ficam em [media-control.ts](../../src/lib/server/media-control.ts) e
[media-control.test.ts](../../tests/media-control.test.ts).

## Verificação

- Teste de domínio do catálogo e resposta sem segredos: passou.
- Prova local com dois MediaMTX e FFmpeg: catálogo informou quatro segmentos;
  FFprobe validou H.264/AAC em arquivo da origem e do destino RTMPS. O
  destino entrou em `forwarding` durante a publicação.
- `bun run typecheck`, `bun run lint` e `bun run build`: passaram localmente.

## Ainda necessário

O catálogo não mede saúde contínua, espaço livre, checksum, retenção nem
restauração. A [etapa 006](006-intencao-reconciliacao-midia.md) passou a
reconciliar intenções após reinício com lease no banco e emitir notificações
internas de falha/normalização; ainda faltam monitoramento externo, supervisão
do worker em produção e ensaio entre processos reais.
A prova de continuidade com queda de WAN e o teste de
câmeras, mesa de áudio e contas institucionais são critérios de saída desta
etapa antes de qualquer piloto oficial. O próximo incremento deve criar
alarmes e ensaio de falhas prolongado.
