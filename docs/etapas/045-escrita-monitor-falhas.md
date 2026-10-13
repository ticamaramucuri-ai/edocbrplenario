# Etapa 045 — Escrita concorrente, observação independente e falhas controladas

**Data:** 13/10/2026 · **Estado:** ensaios sintéticos locais aprovados; homologação institucional pendente.

`scripts/staging-vote-load.py` usa somente a base PostgreSQL cuja única Câmara é `staging-example`. Cria uma sessão **não oficial** pela API autenticada, registra presença, executa 20 votações nominais com 11 votos concorrentes por rodada e encerra cada votação e a sessão. Um operador sintético com papel `session_operator` é provisionado na base de ensaio com o mesmo hash de senha do administrador sintético; nenhum usuário institucional é criado. O script repete uma chave de comando por rodada e consulta a base para conferir a contagem de votos, recibos, eventos de auditoria e outbox. Foram registrados 220 votos e 220 recibos, sem duplicação nos reenvios. Na rodada com observação simultânea, a mediana das chamadas de voto foi 134,195 ms e o p95, 221,65 ms. Esse perfil é limitado a um host, uma Câmara e 11 clientes; não mede uma sessão oficial, tráfego audiovisual ou vários nós de aplicação.

A conferência adicional da outbox encontrou um defeito: reenviar `commandId` devolvia o voto existente, mas emitia outro evento `vote.recorded`. O serviço de votação agora só cria evento quando há voto novo ou alteração efetiva. O teste de jornada cobre explicitamente o reenvio e exige um único evento; a carga PostgreSQL confere 220 votos, 220 recibos, 220 registros `vote.cast` e 220 eventos `vote.recorded` após 20 reenvios.

`scripts/staging-observe.py` roda **fora dos contêineres** no mesmo computador. Durante 45,14 s de uma execução da carga corrigida, fez 21 amostras das rotas HTTP da aplicação, realtime e capturador de correio, além dos estados de saúde dos sete serviços Docker. Não observou falhas. Isso demonstra um observador independente dos processos monitorados, mas não substitui monitoramento fora do host, armazenamento de métricas, alertas para plantão nem observação de uma sessão longa.

`scripts/staging-storage-fault.py` oculta temporariamente apenas o arquivo de replay da sessão sintética `stage-media-recovery`, sempre o restaura em `finally` e compara o hash antes/depois. A rota pública falhou fechada com HTTP 409 enquanto o arquivo estava indisponível e voltou a HTTP 206 depois; a publicação no banco permaneceu intacta. Não houve falha real do volume nem prova de redundância do armazenamento.

O ensaio `scripts/staging-mail-drill.py` passou a desligar o capturador SMTP após as provas de envio e rejeição, criar uma entrega enquanto o relay está fora, observar uma tentativa falha e reiniciar o capturador em `finally`. A entrega pendente saiu na segunda tentativa. O Mailpit agora persiste sua caixa sintética em volume Docker, preservando as três mensagens de prova através do reinício. Nenhuma mensagem foi enviada ao exterior. O ensaio não mede bounce, reputação de domínio ou conexão com o provedor institucional.

```bash
python3 scripts/staging-observe.py
python3 scripts/staging-storage-fault.py
python3 scripts/staging-mail-drill.py
python3 scripts/staging-smoke.py
```

[Evidência estruturada](045-prova-escrita-monitor-falhas.json). A próxima validação técnica deve manter a carga por duração e volume representativos, exercitar banco, realtime e armazenamento sob falhas simultâneas em infraestrutura separada, e medir alertas e RTO/RPO pactuados. A entrada de Mucuri no piloto continua dependente de composição, regras, usuários, canais e aceite oficiais. Nextcloud e Alfresco permanecem nas fases finais do projeto.
