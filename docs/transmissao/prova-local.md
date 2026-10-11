# Prova local de transmissão

Este ensaio exercita a cadeia **fonte sintética FFmpeg → RTMP → MediaMTX → RTMPS → segundo MediaMTX**, com gravação nos dois pontos e métricas HTTP. Usa somente `127.0.0.1`, gera certificado temporário e não acessa redes sociais. O script apaga os arquivos temporários ao sair; `KEEP_MEDIA_SMOKE=1` os preserva para inspeção.

## Dependências e execução

- FFmpeg com H.264 (`libx264`) e AAC, `ffprobe`, `curl`, `openssl`, Python 3.
- MediaMTX **v1.21.2**, binário Linux x86-64 validado pelo `checksums.sha256` da [release oficial](https://github.com/bluenviron/mediamtx/releases/tag/v1.21.2). Usar outra versão exige revisar a configuração e registrar novo resultado.

```bash
mkdir -p /tmp/legis-mediamtx && cd /tmp/legis-mediamtx
curl -fLO https://github.com/bluenviron/mediamtx/releases/download/v1.21.2/mediamtx_v1.21.2_linux_amd64.tar.gz
curl -fLO https://github.com/bluenviron/mediamtx/releases/download/v1.21.2/checksums.sha256
grep 'mediamtx_v1.21.2_linux_amd64.tar.gz' checksums.sha256 | sha256sum -c
tar xzf mediamtx_v1.21.2_linux_amd64.tar.gz mediamtx
cd /home/suporte/Work/edocBRplenario2
MEDIAMTX_BIN=/tmp/legis-mediamtx/mediamtx bun run test:media:smoke
```

O teste só passa se o stream de origem **e** o destino RTMPS ficarem `ready` nas métricas e se as duas gravações contiverem H.264 e AAC legíveis pelo `ffprobe`. As portas locais são 19350/19360 para RTMP/RTMPS e 9998/9997 para métricas. Portas ou ferramentas indisponíveis fazem o teste falhar. O [CI](../../.github/workflows/ci.yml) executa a mesma prova com binário verificado.

## Limites da prova e ensaio de campo

O destino local usa certificado temporário cuja impressão digital é conferida pelo encaminhamento. Isso prova o caminho TLS, mas não a aceitação de ingestão pelo YouTube/Facebook, a qualidade do retorno da plataforma, a recuperação após falha nem o desempenho com câmeras e mesa de som reais. Antes de integrar ao Painel de Transmissão: inventariar câmeras, capturadoras, áudio e rede; medir vídeo/áudio, CPU, bitrate, latência, upload e quadros perdidos; ensaiar perda do encoder, RTMPS/WAN e energia; conferir gravação local contínua e retorno por destino. Nenhuma chave de stream deve entrar em configuração versionada ou log.

Configuração e métricas seguem a [referência do MediaMTX](https://mediamtx.org/docs/references/configuration-file), [encaminhamento](https://mediamtx.org/docs/features/forward), [gravação](https://mediamtx.org/docs/features/record) e [métricas](https://mediamtx.org/docs/features/metrics).
