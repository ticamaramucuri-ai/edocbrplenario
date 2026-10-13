# Etapa 045 — Transições de saúde e carga prolongada

**Data:** 13/10/2026 · **Estado:** ensaios sintéticos locais aprovados; metas institucionais ainda não medidas.

O observador de homologação `scripts/staging-watch.py` sonda a aplicação, realtime e capturador SMTP por HTTP e confere a saúde dos sete serviços Docker. Executa fora dos contêineres, no mesmo host, e registra em JSONL cada mudança de estado, com horário UTC e causas identificadas, sem credenciais. Sai com erro se encontrar degradação; o modo `--allow-degraded --require-recovery` serve apenas para ensaios controlados. `scripts/staging-watch-fault.py` exige a base exclusiva `staging-example`, observa uma linha inicial saudável, interrompe o realtime, verifica a abertura do incidente e o religa em `finally`. A prova corrigida detectou a queda em 1,06 s e observou o retorno à saúde 12,57 s após o comando de reinício; a aplicação permaneceu disponível. São tempos do laboratório local e incluem a cadência das sondas e o health Docker, **não** RTO contratual nem prova de alerta recebido por plantão.

`scripts/staging-observe.py --seconds 90 --runs 8 --interval 2` executou oito jornadas sintéticas de sessão/votação sob observação contínua. Em 90,43 s, 42 sondagens não encontraram degradação. As jornadas ocuparam 75,52 s e registraram 1.760 votos, 1.760 recibos e 1.760 eventos `vote.recorded`; o pior p95 entre as oito jornadas foi 247,34 ms. Cada jornada confere também o número de eventos de auditoria. O perfil ainda usa um host, uma Câmara fictícia, 11 eleitores concorrentes e pausas entre rodadas; não representa uma sessão oficial completa com vídeo, público remoto e múltiplos nós.

`scripts/staging-realtime-write-fault.py` manteve uma jornada de 220 votos durante a parada do realtime. Observou 30 eventos pendentes enquanto o serviço estava fora; após o retorno, os 330 eventos da sessão estavam publicados, incluindo os 220 votos, e não havia pendência da sessão. O intervalo desde o comando de reinício até a drenagem foi 8,06 s, incluindo o restante da jornada de escrita. A API continuou respondendo. O teste demonstra a fila durável neste cenário; entrega Socket.IO a todos os navegadores e fanout com mais de um nó seguem pendentes.

```bash
python3 scripts/staging-watch.py --seconds 300 --output tool-results/staging-watch.jsonl
python3 scripts/staging-watch-fault.py
python3 scripts/staging-observe.py --seconds 90 --runs 8 --interval 2
python3 scripts/staging-realtime-write-fault.py
```

[Evidência estruturada](045-prova-alertas-carga-prolongada.json). A próxima prova antes de um piloto deve sair deste host: observador e armazenamento de métricas separados, acionamento real de plantão, carga com vídeo e leitura pública, falhas combinadas de banco/rede/armazenamento, backup/restauração com metas de RTO/RPO aprovadas. As regras e contas institucionais de Mucuri ainda precisam de conferência e aceite; Nextcloud e Alfresco continuam para o final do desenvolvimento do plenário.
