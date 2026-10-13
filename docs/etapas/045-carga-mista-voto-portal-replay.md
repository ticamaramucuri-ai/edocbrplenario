# Etapa 045 — Carga mista de votação, portal e replay

**Data:** 13/10/2026 · **Estado:** ensaio local sintético aprovado; capacidade institucional não homologada.

`scripts/staging-mixed-load.py` combina jornadas autenticadas de votação com leitores concorrentes do bootstrap, da lista pública de sessões e do replay. Antes de iniciar, exige que a base PostgreSQL contenha exclusivamente `staging-example`, que a stack esteja saudável e que o replay sintético já esteja publicado. Cada leitura do vídeo inteiro compara SHA-256 com o manifesto armazenado; cada jornada confere votos, recibos, auditoria e eventos da outbox. Ao final, o script exige que todos os eventos das sessões criadas estejam publicados. O script não cria sessão oficial nem usa dados ou canal social da Câmara.

Duas execuções passaram no mesmo host:

| Perfil | Duração | Leituras públicas | Erros | Votos / recibos / eventos de voto | Pior p95 de voto | Pior p95 de replay |
|---|---:|---:|---:|---:|---:|---:|
| 4 leitores, 3 jornadas | 40,34 s | 2.715 | 0 | 660 / 660 / 660 | 238,88 ms | 16,75 ms |
| 8 leitores, 2 jornadas | 30,21 s | 3.722 | 0 | 440 / 440 / 440 | 304,77 ms | 23,56 ms |

Nenhuma sondagem da stack registrou falha nas duas execuções. O replay conservou o hash `fb851da5f5fb4da2b005ebd1083b9b64740230f374b46707bb868a21919aade5`. Os tempos incluem rede loopback, arquivo de cerca de 60 KiB e um único host. Não medem espectadores externos, vídeo ao vivo, múltiplas instâncias, duração de sessão real ou capacidade contratual.

```bash
python3 scripts/staging-media-drill.py
python3 scripts/staging-mixed-load.py --seconds 40 --runs 3 --readers 4
python3 scripts/staging-mixed-load.py --seconds 30 --runs 2 --readers 8
```

[Evidência estruturada](045-prova-carga-mista.json). O próximo ensaio de capacidade precisa incluir encoder, transmissão e espectadores em outra rede, além de uma sessão longa e infraestrutura separada. A configuração e o aceite institucional de Mucuri continuam necessários para o piloto; Nextcloud e Alfresco permanecem nas fases finais.
