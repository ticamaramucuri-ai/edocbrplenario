# Etapa 026 — Continuidade da transmissão

**Data:** 11/10/2026 · **Estado:** validação integrada local concluída; homologação externa pendente.

O teste integrado da transmissão agora cobre a perda e o retorno do sinal local após a publicação do link. Confirma que `effectiveStatus` muda para `signal_lost` e retorna a `monitoring`, enquanto a intenção do destino e o link permanecem rastreáveis. Valida o estado observado do encaminhamento, o catálogo de gravação e a ausência de stream key nas respostas. O teste de reconciliação já cobre reaplicação após reinício do MediaMTX, falha do controlador, nova tentativa e desativação. Ambos estão na CI.

O [roteiro de continuidade](../transmissao/continuidade-operacional.md) descreve checagem externa, queda de fonte, falha de destino, recuperação e encerramento por Câmara. A prova física com FFmpeg → MediaMTX → RTMPS local → fMP4 existe em `scripts/media-smoke.sh`, mas não foi executada nesta etapa porque o binário MediaMTX não está instalado no host atual. A inspeção de vídeo/áudio nas redes sociais depende de conta institucional de teste e stream key autorizada.

Verificações desta etapa: `bun run test:media:public-link`, `bun run test:media:integration`, `bun run typecheck` e `bun run lint`.

**Próxima fase:** homologação ponta a ponta em ambiente de mídia dedicado, com conta institucional de teste, medição de latência, queda de WAN/encoder, recuperação e conferência do replay. Integrações com Nextcloud e Alfresco permanecem para o final do projeto.
