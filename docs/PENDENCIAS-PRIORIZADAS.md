# Pendências priorizadas — edocBR Plenário

Este registro acompanha o [diagnóstico](DIAGNOSTICO-E-PLANO-DE-CONCLUSAO.md). “Responsável” indica o papel que deve fechar a prova; nomes e aceites institucionais só serão preenchidos com a Câmara.

Revisão de 13/10/2026: o [plano corrente](PLANO-ATUALIZADO-2026-10-13.md) distingue incrementos técnicos concluídos de homologação pendente. O telão tem ensaio sintético em três navegadores e dois nós; a fase 045 continua aberta até prova operacional fora do host e aceite das metas. Acessibilidade automatizada iniciou pela entrada, painel e telão; o leitor de tela humano e equipamento real continuam na fase 053.

Revisão de 20/10/2026: a trilha A do [plano de continuidade](PLANO-CONTINUIDADE-2026-10-20.md) fechou os fundamentos do repositório — ver [`etapas/045-fundamentos-do-repositorio.md`](etapas/045-fundamentos-do-repositorio.md). Duas pendências novas nascem dela, abaixo. As trilhas B e C continuam esperando host de homologação separado; D e E, dado e assinatura da Câmara.

Revisão de 21/10/2026: a limpeza dos 15 tenants sintéticos foi aplicada (base de desenvolvimento com os três tenants reais, `foreign_key_check` e `integrity_check` limpos, backup verificável em `db/bundle-clean-test-tenants-20261021T140704Z`). Decidido que o projeto **não tem VPS**: o desenvolvimento segue local e a seção Deploy do `CLAUDE.md` registra isso — deixa de ser pendência. A trilha B do plano de continuidade permanece bloqueada por falta de host separado.

| Prioridade | Fase | Pendência | Responsável funcional | Evidência de fechamento |
|---|---:|---|---|---|
| Média | 045 | Retenção dos backups locais de `db/` (simulada e conferida; 19 arquivos, 19,1 MB) | Operação SaaS | `db:backup:prune --apply` executado com os rótulos citados em documento protegidos por `--keep-pattern` |
| Alta | 044 | Arquivos de foto/emblema e mídia sobreviverem a troca de instância/restauração | Operação SaaS | Inventário sem ausências, snapshot dos diretórios, restore em ambiente descartável e hashes iguais |
| Alta | 045 | PostgreSQL ativo com serviços, correio, fanout realtime e recuperação; leases e rate limit já ensaiados | Engenharia de plataforma | Ensaio de falha e restore conjunto com tempos medidos, CI e runbook |
| Bloqueante | 046 | Regimento, composição e papéis oficiais por Câmara — formulários prontos em [`aceite/`](aceite/README.md), aguardando preenchimento e assinatura | Secretaria legislativa e Presidência da Câmara | Matriz de casos e configuração versionada aprovadas |
| Alta | 047 | Convocação com prova de entrega/ciência e documentos versionados | Secretaria legislativa | Jornada e comprovantes de envio revisados |
| Alta | 048–049 | Quórum por ato, identificação e apuração nominal/simbólica | Mesa e secretaria | Sessões simuladas, conferência humana e testes concorrentes |
| Bloqueante para modalidade | 050 | Sigilo real do voto secreto e continuidade offline | Segurança e Mesa | Revisão independente; modalidade desabilitada até aceite |
| Alta | 051 | Ata, assinaturas, portal e retificação por novo ato | Jurídico/secretaria | Documentos e publicação aprovados |
| Alta | 052 | Redes sociais com canal institucional, imagem/áudio observados externamente | Audiovisual da Câmara | Sessão privada, falha/retorno, gravação e replay íntegros |
| Alta | 053 | Piloto Mucuri, acessibilidade e treinamento | Câmara e operação SaaS | Termos de aceite técnico, legislativo e audiovisual |
| Alta | 048–049 | Carga concorrente de jornada, telão e portal com dois nós de tempo real (tarefa 12 da trilha C) | Engenharia de plataforma | Atrasos p50/p95, eventos perdidos e quadro congelado medidos sob votação e leitura simultâneas |
| Final | 054–056 | Nextcloud/Alfresco: leitura, reconciliação e escrita autorizada | TI institucional e engenharia | Identidades externas, versões/hashes, retry e reversão ensaiados |
