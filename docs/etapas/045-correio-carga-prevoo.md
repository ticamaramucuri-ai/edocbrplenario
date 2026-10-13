# Etapa 045 — Correio em laboratório, carga de leitura e pré-voo

**Data:** 13/10/2026 · **Estado:** provas locais sintéticas aprovadas; piloto institucional bloqueado.

O perfil opcional `mail-lab` acrescenta Mailpit à stack PostgreSQL e inicia o worker de correio. O SMTP exige STARTTLS, aceita apenas destinatários `@example.invalid`, não possui encaminhamento externo e expõe a interface de captura somente em `127.0.0.1:3125`. O certificado de 30 dias é criado localmente em diretório ignorado pelo Git e pelo contexto de build Docker; entra nos contêineres somente pelo volume de ensaio. O worker valida esse certificado por `SMTP_TLS_CA_FILE`; em operação normal continua exigindo a cadeia de confiança padrão. O encerramento por SIGTERM/SIGINT agora interrompe a espera entre lotes, permitindo parar o processo sem aguardar o intervalo de cinco segundos.

```bash
bash scripts/staging-mail-lab-setup.sh
docker compose -f deploy/staging/compose.yaml --profile mail-lab up -d mailpit mail_worker
python3 scripts/staging-mail-drill.py
python3 scripts/staging-read-load.py
DATABASE_URL=file:../db/custom.db bun run pilot:preflight --tenant=camara-mucuri-ba
```

O ensaio de correio exige a sessão sintética `stage-media-recovery` gerada por `scripts/staging-media-drill.py` e recusa uma base com mais de um tenant ou sem `staging-example`. Cria uma assinatura e confirma na API local do capturador que a mensagem saiu por STARTTLS. Depois força uma rejeição SMTP para endereço fora da faixa permitida, verifica a permanência na fila e demonstra a segunda tentativa após corrigir o destinatário sintético. Foram capturadas duas mensagens, com estados `sent` e duas tentativas para a mensagem recuperada. A prova verifica aceitação no capturador; **não comprova entrega a caixas externas, reputação do domínio, bounce ou credenciais institucionais**. A lista do capturador contém links temporários de confirmação: não a publique.

A carga de leitura fez 300 pedidos em 16 clientes: 100 bootstrap, 100 listagens públicas de sessões e 100 leituras parciais (HTTP 206) do replay sintético. Não houve erros; mediana de 30,455 ms, p95 de 70,53 ms, p99 de 80,52 ms, 398,4 requisições/s no host local. O script delimita esse perfil para comparação de regressões. Não inclui escrita concorrente, votos, sockets, vídeo em tempo real, latência de rede externa, volume ou duração representativos de uma sessão real; esses números não são uma meta de capacidade institucional.

O pré-voo de Mucuri voltou a indicar `automaticReady=false` (saída 2): Câmara ativa, mas sem composição/regras aprovadas, papéis operacionais, PostgreSQL do piloto, SMTP institucional ou destino social público. Há zero sessões oficiais. A prova SMTP e a carga foram feitas **apenas** no tenant `staging-example`; elas não alteram o estado de prontidão de Mucuri. As cinco evidências de aceite institucional continuam pendentes.

[Evidência estruturada desta rodada](045-prova-correio-carga-prevoo.json). Também passaram `bun run test:mail:delivery`, `bun run typecheck`, `scripts/staging-smoke.py` e o build de produção PostgreSQL. O próximo incremento técnico é um ensaio prolongado com escritas/votos sintéticos, monitoramento externo e falhas de armazenamento/rede; depois, com dados e responsáveis aprovados pela Câmara, ensaio institucional de SMTP, transmissão, acessibilidade e recuperação. Nextcloud e Alfresco permanecem para o final do desenvolvimento do plenário.
