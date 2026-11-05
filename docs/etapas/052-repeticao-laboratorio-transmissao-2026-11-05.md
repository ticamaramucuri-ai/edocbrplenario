# 052 — Repetição da transmissão com carga legislativa

**Data:** 05/11/2026. **Estado:** ensaio local sintético concluído; publicação social institucional pendente.

## Ambiente e execução

Foi usada somente a stack `staging-example`, com isolamento conferido pelo próprio `staging-live-mixed-drill.py`. Os serviços do perfil de correio de laboratório foram iniciados e a sonda retornou `[]` (sem falhas). O MediaMTX `v1.21.2` foi obtido pelo auxiliar que valida o SHA-256 do arquivo da distribuição. Os comandos executados foram:

```bash
bash scripts/prepare-media-smoke.sh
python3 scripts/staging-live-mixed-drill.py
python3 scripts/staging-media-drill.py
bun run test:media:public-link
bun run test:media:archive
```

O ensaio conjunto terminou em **42,07 s** com `ok: true`, `synthetic: true`, `sameHost: true` e `official: false`. Recebeu vídeo/áudio sintéticos em dois receptores RTMPS locais, observou a queda do primeiro e a continuidade do segundo, reconectou a origem em **1.800 ms** e o receptor em **4.006 ms**. Foram gravados **11** segmentos na origem, **6** no receptor A e **7** no B, inspecionados por FFprobe como H.264/AAC. Em paralelo, ocorreram **660 votos**, **660 recibos** e **2.925 leituras públicas sem erro**. O SHA-256 do replay foi `fb851da5f5fb4da2b005ebd1083b9b64740230f374b46707bb868a21919aade5`.

O ensaio de arquivo no staging confirmou `archiveIntegrity: valid`, dois segmentos e resposta pública parcial **HTTP 206** para o replay. `test:media:public-link` passou com 2 testes e 43 asserções: exige observação de vídeo/áudio por outra identidade para sessão oficial, mostra o link somente após publicação vinculada, detecta perda do sinal local no painel e permite retirada do link; `test:media:archive` passou com 1 teste e 21 asserções, incluindo isolamento e adulteração. O painel de mídia exibe alerta e ação de retirada quando a fonte ou o destino publicado deixam de estar confirmados. A deliberação prosseguiu durante a falha de um destino, sem depender do encaminhamento de mídia.

## Limite e próximo gate

Os dois receptores, o encoder, o banco e os leitores estavam no mesmo computador. Nenhum canal de YouTube, Facebook ou outra rede social foi usado; `socialPlatformConfirmed` permaneceu `false`. O áudio era uma senoide e o vídeo um padrão sintético. A observação da página pública, câmeras, microfones, banda, audiência, host externo e aceite audiovisual dependem de responsáveis e contas institucionais. O próximo incremento local é o **pacote de homologação**; a fase 052 só poderá ser homologada depois de ensaio no canal real com observador em outra rede.
