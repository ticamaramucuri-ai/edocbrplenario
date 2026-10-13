# Etapa 045 — Transmissão sintética com carga simultânea do plenário

**Data:** 13/10/2026 · **Estado:** prova local aprovada; canal social e operação institucional não homologados.

`scripts/staging-live-mixed-drill.py` exige que a base de homologação contenha somente a Câmara fictícia `staging-example` e que todos os serviços estejam saudáveis. Executa em paralelo o ensaio existente de FFmpeg → MediaMTX → dois receptores RTMPS locais e a [carga mista](045-carga-mista-voto-portal-replay.md) de votação, portal e replay. A prova de mídia usa certificados temporários, confere seus fingerprints, observa queda/retorno do encoder e do primeiro receptor, verifica que o segundo continua encaminhando e inspeciona H.264/AAC nos segmentos gravados. O ensaio combinado lê os relatórios das duas partes e falha se houver divergência de votos, recibos, eventos, leituras ou gravações. Os artefatos temporários da prova de mídia são removidos após a verificação.

Na execução local, em 41,55 s, foram registrados **660 votos, 660 recibos e 2.672 leituras públicas sem erro**. A origem gravou 11 segmentos; os receptores A e B gravaram 6 e 7. A origem e os encaminhamentos voltaram a ficar prontos 2,014 s depois do reinício do encoder; o receptor A voltou em 3,949 s após reinício. O receptor B seguiu ativo durante a falha de A. O replay consultado pelo público manteve o SHA-256 registrado na base. [Evidência estruturada](045-prova-transmissao-carga-conjunta.json).

```bash
bash scripts/prepare-media-smoke.sh
python3 scripts/staging-media-drill.py
python3 scripts/staging-live-mixed-drill.py
```

O MediaMTX, os receptores e os leitores usaram o mesmo computador e endereços locais. Não houve publicação em YouTube, Facebook ou outra rede social, nem observação de uma página externa. O vídeo sintético não representa câmeras, microfones, banda, duração ou audiência de uma sessão. O próximo ensaio depende de infraestrutura separada, equipamentos, canal e observadores institucionais; sua aprovação deve incluir imagem, voz, sincronismo, falha/retorno, gravação, replay e metas operacionais. Nextcloud e Alfresco permanecem para as fases finais.
