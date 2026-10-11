# Registro de execução do plano

Cada etapa do [plano diretor](../PLANO-DESENVOLVIMENTO-PLENARIO.md) terá um arquivo numerado neste diretório. O registro deve conter: objetivo, mudança entregue, arquivos principais, verificações com resultado, limitações conhecidas, decisão técnica e critérios de entrada/saída da etapa seguinte. Uma etapa só recebe estado **concluída** quando os critérios de saída foram demonstrados; trabalho parcial permanece **em andamento**.

| Etapa | Estado | Entrega | Próxima dependência |
|---|---|---|---|
| [001 — Segurança de acesso e base de mídia](001-seguranca-acesso-midia.md) | Concluída para o escopo definido | Perfil demo isolado, token de tempo real, pesquisa de software de transmissão | Baseline de tipos/CI e prova de mídia com equipamentos reais |
| [002 — Qualidade e prova de transmissão](002-qualidade-e-prova-transmissao.md) | Em andamento | Tipos e CI local, RTMP→RTMPS com gravação/métricas, contrato do painel | CI remoto e homologação com mídia real |
| [003 — Painel de transmissão: fonte local](003-painel-transmissao-local.md) | Em andamento | API/aba de acompanhamento local com RBAC, idempotência, auditoria e perda de sinal | Controlador, destinos sociais e operador audiovisual dedicado |
| [004 — Destinos RTMPS](004-destinos-rtmps.md) | Em andamento | Papel audiovisual, API de controle MediaMTX e prova local RTMP→RTMPS com gravação | Contas reais e homologação audiovisual |
| [005 — Gravação e resiliência](005-gravacao-e-resiliencia.md) | Em andamento | Catálogo de segmentos no painel e prova local de arquivos H.264/AAC | Alertas, falhas prolongadas e hardware real |
| [006 — Intenção e reconciliação](006-intencao-reconciliacao-midia.md) | Em andamento | Comando 202 durável, worker com lease/retry, notificações e recuperação após reinício | Supervisão, monitoramento externo, falhas prolongadas e PostgreSQL |
| [007 — Saúde operacional da mídia](007-saude-operacional-midia.md) | Em andamento | Heartbeat persistido, verificador com código de saída e timer de exemplo | Alertas externos, ensaios de falha e homologação no piloto |
| [008 — Concorrência entre destinos](008-concorrencia-destinos-midia.md) | Concluída para o escopo definido | Lease por caminho entre processos evita sobrescrita de destinos | Teste com réplicas reais e infraestrutura piloto |
| [009 — Identidade edocBR e Mucuri](009-identidade-edocbr-mucuri.md) | Concluída localmente para o escopo definido | Identidade visual aplicada e tenant institucional mínimo, com seed demo protegido | Plano funcional e dados regimentais de Mucuri; piloto audiovisual. Integrações externas só ao final |
| [010 — Preparação da sessão](010-preparacao-sessao.md) | Concluída localmente para rascunho/numeração | Criação não publica pauta, confirmação explícita, contador anual transacional e teste da jornada | Pauta versionada, checklist institucional e homologação com Mucuri |
| [011 — Política de publicação por Câmara](011-politica-publicacao-saas.md) | Concluída para o escopo inicial | Tipos, secretário e mínimo de matérias por tenant; edição de rascunho; revisão 1 | Emendas versionadas à pauta |
| [012 — Emendas à pauta publicada](012-emendas-pauta-publicada.md) | Concluída localmente para o escopo definido | Prévia e confirmação de inclusão, reordenação e retirada, com revisão e motivo públicos | Convocação formal e política regimental por Câmara |
| [013 — Convocação pública por Câmara](013-convocacao-publica-saas.md) | Concluída localmente para emissão/consulta | Antecedência por Câmara, conteúdo congelado e SHA-256 por revisão | Ciência dos destinatários e regras de exceção |
| [014 — Ciência da convocação](014-ciencia-convocacao.md) | Concluída localmente para registro interno | Destinatários congelados por revisão, ciência individual e acompanhamento | Regras regimentais de retificação e exceção por Câmara |
| [015 — Prazos de retificação e urgência](015-prazos-retificacao-urgencia.md) | Concluída localmente para política de prazo | Prazo de emenda por Câmara, exceção por tipo com justificativa pública | Calendário de vencimentos e homologação regimental |
| [016 — Calendário de prazos da sessão](016-calendario-prazos-sessao.md) | Concluída localmente para acompanhamento | Vencimentos por fase e Câmara, fuso institucional e alerta visual na Mesa | Alertas persistidos e validação do regimento piloto |
| [017 — Alertas persistidos de prazo](017-alertas-persistidos-prazo.md) | Concluída localmente para notificações internas | Avisos prévios e de atraso, deduplicação, agendador e ajuste da base demo | Homologação dos destinatários e regras regimentais |
| [018 — Destinatários por mandato e licença](018-destinatarios-mandato-licenca.md) | Concluída localmente para seleção opcional | Política por Câmara, substituição explícita, prévia e snapshot por revisão | Homologação regimental e regras de quórum/maioria |
| [019 — Política de quórum e maioria](019-politica-quorum-maioria.md) | Concluída localmente para matéria vinculada | Regra e quórum por tipo, snapshot da base de membros e apuração uniforme | Base deliberativa, impedimentos e homologação regimental |
| [020 — Base deliberativa por Câmara](020-base-deliberativa.md) | Concluída localmente para política opcional | Mandato, licença, suplente, presença e lista de votantes congelada | Impedimentos por votação e homologação regimental |
| [021 — Impedimentos na votação](021-impedimentos-votacao.md) | Concluída localmente | Registro e política opcional por Câmara para impedimentos | Transparência da base usada na apuração |
| [022 — Relatórios da base de votação](022-relatorios-base-votacao.md) | Concluída localmente | Base e impedimentos nos relatórios e dados públicos seguros | Fluxo excepcional de votação |
| [023 — Fluxo excepcional da votação](023-fluxo-excepcional-votacao.md) | Concluída localmente | Cancelamento e coerência com sessão e pauta | Integridade da anulação |
| [024 — Integridade da anulação](024-integridade-anulacao.md) | Concluída localmente | Proteção contra anulação de deliberação já sucedida e correção pública | Link e validação da transmissão |
| [025 — Link público da transmissão](025-link-publico-transmissao.md) | Concluída localmente | Confirmação do operador, publicação e retirada do link por sessão e Câmara | Continuidade e teste físico |
| [026 — Continuidade da transmissão](026-continuidade-transmissao.md) | Validação integrada local concluída | Testes de perda/retorno de sinal, reconciliação e roteiro operacional | Ensaio físico e homologação social |
| [027 — Ensaio físico de mídia local](027-homologacao-midia-local.md) | Ensaio local concluído | RTMP→RTMPS, gravação, recuperação do encoder e receptor com evidência | Homologação com conta institucional e ambiente dedicado |
| [028 — Replay local verificável](028-replay-local-verificavel.md) | Concluída localmente | Manifesto SHA-256, MP4, publicação controlada, player e isolamento por Câmara | Jornada completa e aceite institucional do vídeo |
| [029 — Jornada completa em ensaio](029-jornada-completa-ensaio.md) | Concluída localmente para cenário fictício | Pauta, convocação, fala, votos, correção, ata, perda de mídia e duas Câmaras no mesmo teste | PostgreSQL e homologação regimental |
| [030 — Base operacional PostgreSQL](030-base-operacional-saas.md) | Em andamento | DDL PostgreSQL e backup/restauração em contêiner efêmero | Adaptar cliente Prisma e mini-serviços SQLite antes de migrar dados |
| [031 — Operação, acessibilidade e capacidade](031-operacao-acessibilidade-capacidade.md) | Em andamento | Checklist no painel, isolamento, teclado e ensaio 21 votos/40 leituras | Leitor de tela e equipamento real |
| [032 — Dois destinos RTMPS locais](032-multiplos-destinos-locais.md) | Prova técnica local concluída | Dois receptores, falha independente, recuperação e gravação H.264/AAC | Banda dedicada e homologação social |
| [033 — Outbox PostgreSQL](033-realtime-postgres.md) | Concluída localmente | Leitura e confirmação dos eventos por Câmara | Operação piloto |
| [034 — Webhooks PostgreSQL](034-webhooks-postgres.md) | Concluída localmente | Entrega e retry em PostgreSQL | Operação piloto |
| [035 — Scheduler PostgreSQL](035-scheduler-postgres.md) | Concluída localmente | Jobs e saúde em PostgreSQL | Operação piloto |
| [036 — Serviços integrados PostgreSQL](036-ensaio-integrado-postgres.md) | Ensaio local concluído | Serviços, DDL e testes integrados | Migração de dados |
| [037 — Executor e cópia](037-executor-copia-postgres.md) | Ensaio sintético concluído | Migrações versionadas e cópia transacional | Réplica do piloto |
| [038 — Réplica do piloto](038-ensaio-replica-piloto.md) | Ensaio local concluído | 70 tabelas e 448 linhas conciliadas | Inventário e leituras funcionais |
| [039 — Ativos e réplica funcional](039-inventario-ativos-replica-funcional.md) | Ensaio local concluído | Links fictícios corrigidos, auditoria de arquivos e leitura Prisma por Câmara | Rotas HTTP e carga representativa |
| [040 — HTTP na réplica PostgreSQL](040-ensaio-http-replica-postgres.md) | Ensaio local concluído | Rotas públicas/autenticadas, isolamento e 40 leituras concorrentes | Homologação semelhante à produção e escrita isolada |
| [041 — Escrita e recuperação PostgreSQL](041-homologacao-escrita-recuperacao-postgres.md) | Ensaio local concluído | Build de produção, jornada HTTP com cookie real, backup pós-escrita e recuperação HTTP | Falhas dos serviços auxiliares e métricas operacionais |
| [042 — Imagens de parlamentares no telão](042-imagens-parlamentares-telao.md) | Implementação local concluída | Upload de foto e emblema por Câmara, cadastro e exibição no telão | Arquivos persistentes e identidade partidária centralizada |

O plano diretor define a direção do produto; este diretório registra o que foi realmente implementado e testado. Evidências e limites devem ser atualizados no mesmo arquivo quando surgir uma correção da etapa.

O [diagnóstico e plano de conclusão](../DIAGNOSTICO-E-PLANO-DE-CONCLUSAO.md) reúne as lacunas atuais e propõe a ordem das próximas fases (043–057). Essas fases propostas não entram nesta tabela até terem implementação e evidência próprias.
