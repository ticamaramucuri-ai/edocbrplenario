# Etapa 045 — Mídia vinculada e recuperação após falha do banco

**Estado em 13/10/2026:** provas locais sintéticas aprovadas; homologação institucional pendente.

A imagem de homologação agora instala FFmpeg/FFprobe, necessários para inspecionar segmentos H.264/AAC e gerar replay no processo da aplicação. `scripts/staging-media-drill.py` usa apenas o tenant `staging-example`, prepara uma sessão encerrada de prova, produz dois segmentos curtos, chama a API de construção e publicação do replay, verifica a integridade pela API e lê 32 bytes pela rota pública com `Range` (HTTP 206). A sessão de prova é criada diretamente no banco pelo script, exclusivamente para exercitar o estado encerrado sem simular uma deliberação; não representa ato legislativo nem valida o fluxo regimental de encerramento. O script é idempotente e preserva essa fixture sintética para os próximos ensaios.

`scripts/staging-recovery-drill.py --require-media` interrompe os escritores, cria o pacote conjunto e o restaura em banco e diretórios temporários. Além do manifesto do pacote, consulta cada `SessionRecording` recuperado e compara o hash do manifesto, o tamanho e SHA-256 de cada segmento, e o tamanho e SHA-256 do replay com os bytes restaurados. O banco ativo não é substituído. Nesta prova, um replay e dois segmentos referenciados foram restaurados e verificados.

`scripts/staging-db-outage-drill.py` faz 60 leituras HTTP com oito clientes antes e depois de interromper o PostgreSQL, observa que a API deixa de fornecer bootstrap útil, reinicia o banco e mede o tempo até a primeira resposta útil. Confirma também que o replay sintético permaneceu publicado. A prova registrou 14,588 s desde o comando de início do banco até HTTP 200. As 60 leituras anteriores e as 60 posteriores não tiveram erro. Essa carga pequena mede somente o laboratório local; **não define RTO/RPO nem capacidade para uma sessão real**.

```bash
python3 scripts/staging-media-drill.py
python3 scripts/staging-recovery-drill.py --require-media
python3 scripts/staging-db-outage-drill.py
python3 scripts/staging-smoke.py
```

[Evidência estruturada](045-prova-midia-falha-banco.json). A homologação ainda precisa de volume e duração representativos, falhas de armazenamento/rede, teste de entrega SMTP em relay de homologação, monitoramento externo, equipamento audiovisual, canal social institucional e aceite dos responsáveis. Nextcloud e Alfresco permanecem nas fases finais, após o piloto do plenário.
