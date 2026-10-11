# Etapa 027 — Ensaio físico de transmissão e recuperação local

**Data:** 11/10/2026 · **Estado:** ensaio local concluído; plataforma social ainda pendente.

O ensaio usa FFmpeg para publicar vídeo sintético H.264 e áudio AAC em um MediaMTX v1.21.2 local. Um segundo MediaMTX, somente em loopback, recebe o encaminhamento RTMPS e grava o stream. O script verifica as métricas da origem e do receptor, o estado `forwarding` na Control API, o catálogo de gravações e os codecs dos arquivos antes e depois da recuperação.

Foram simuladas duas interrupções: parada/reinício do encoder e parada/reinício do receptor RTMPS durante a segunda publicação. Em execução neste host, origem e destino voltaram a `ready` em **1.869 ms** após reiniciar o encoder; o receptor voltou a `ready` em **4.147 ms** após seu reinício. O ensaio produziu **11 segmentos na origem** e **6 no receptor**, com H.264/AAC verificados nos primeiros e últimos arquivos. São tempos de observação local de um único teste, não SLA nem medição de latência fim a fim para espectadores.

O binário foi obtido da [versão oficial v1.21.2](https://github.com/bluenviron/mediamtx/releases/tag/v1.21.2) e validado com `checksums.sha256` da mesma release. Para repetir em Linux x86_64:

```bash
bun run media:prepare-smoke
MEDIAMTX_BIN=/tmp/edocbr-mediamtx-v1.21.2/mediamtx KEEP_MEDIA_SMOKE=1 bun run test:media:smoke
```

`KEEP_MEDIA_SMOKE=1` preserva artefatos em `/tmp/legis-media-smoke.*`, incluindo `evidence.json`, logs, métricas e gravações. Sem essa variável, os artefatos temporários são removidos. O teste usa portas de loopback e certificado TLS temporário; não usa chaves institucionais e não acessa redes sociais. Os processos de mídia são encerrados ao terminar; com `KEEP_MEDIA_SMOKE=1`, o arquivo de destinos de teste também fica preservado no diretório temporário.

**Limites:** não houve teste de WAN externa, perda de pacotes, reprodução em YouTube/Facebook/Instagram nem publicação/replay com conta institucional. O portal e os fluxos de autorização permanecem cobertos pelos testes de API; esta prova física cobre o transporte e a gravação locais. A homologação institucional deverá medir latência percebida pelo espectador, estabilidade durante uma sessão completa, áudio, acessibilidade e recuperação real da plataforma.

**Próxima fase:** executar o roteiro em ambiente dedicado e conta institucional de teste, registrar evidências sem credenciais, revisar capacidade/retenção do armazenamento e preparar procedimentos de operação por Câmara. As integrações com Nextcloud e Alfresco seguem reservadas para a etapa final do projeto.
