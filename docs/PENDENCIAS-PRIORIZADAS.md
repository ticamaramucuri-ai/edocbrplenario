# Pendências priorizadas — edocBR Plenário

> **Lista histórica de pendências.** A prioridade e os gates atuais estão no [plano mestre](PLANO-MESTRE.md); este registro não deve ser usado como backlog vigente sem reconciliação.

Incremento P6 em 11/11/2026: o diário local agora persiste a maior época de uma concessão assinada e rejeita recuo após reinício ([etapa 124](etapas/124-maior-epoca-autoridade-local.md)). Ainda faltam entrega da concessão, cercamento dos escritores web, autorização de comandos, ACK e reconciliação; restauração integral de snapshot local exige proteção adicional.

Revisão da landing em 11/11/2026: conteúdo público foi alinhado aos limites do plano mestre. Antes de divulgar institucionalmente, faltam validação da Câmara sobre textos e identidade, comprovação de capacidades anunciadas, política de privacidade e responsável/canal de atendimento definidos, além da liberação dos gates da operação local. A etapa [123](etapas/123-landing-page-e-login-institucional.md) registra a revisão técnica; ela não substitui aceite institucional.

Revisão visual em 11/11/2026: as duas variantes de cor do logo foram unificadas na assinatura edocBR Plenário; cabeçalho e menu móvel foram simplificados. A aprovação da identidade pela instituição continua pendente.

Correção de entrada em 11/11/2026: o refresh da rota `/` não expõe mais o esqueleto claro anterior ao bootstrap. O primeiro quadro é coberto pelo teste de navegador sem JavaScript; a validação visual em dispositivos institucionais permanece parte do aceite.

> Lista histórica com últimas revisões de outubro. O estado e a fila corrente estão no [plano atualizado de 05/11/2026](PLANO-DESENVOLVIMENTO-ATUAL-2026-11-05.md); não interpretar os itens abaixo como inventário atual de Mucuri.

Este registro acompanha o [diagnóstico](DIAGNOSTICO-E-PLANO-DE-CONCLUSAO.md). “Responsável” indica o papel que deve fechar a prova; nomes e aceites institucionais só serão preenchidos com a Câmara.

Revisão de 13/10/2026: o [plano corrente](PLANO-ATUALIZADO-2026-10-13.md) distingue incrementos técnicos concluídos de homologação pendente. O telão tem ensaio sintético em três navegadores e dois nós; a fase 045 continua aberta até prova operacional fora do host e aceite das metas. Acessibilidade automatizada iniciou pela entrada, painel e telão; o leitor de tela humano e equipamento real continuam na fase 053.

Revisão de 20/10/2026: a trilha A do [plano de continuidade](PLANO-CONTINUIDADE-2026-10-20.md) fechou os fundamentos do repositório — ver [`etapas/045-fundamentos-do-repositorio.md`](etapas/045-fundamentos-do-repositorio.md). Duas pendências novas nascem dela, abaixo. As trilhas B e C continuam esperando host de homologação separado; D e E, dado e assinatura da Câmara.

Revisão de 21/10/2026: a limpeza dos 15 tenants sintéticos foi aplicada (base de desenvolvimento com os três tenants reais, `foreign_key_check` e `integrity_check` limpos, backup verificável em `db/bundle-clean-test-tenants-20261021T140704Z`). Decidido que o projeto **não tem VPS**: o desenvolvimento segue local e a seção Deploy do `CLAUDE.md` registra isso — deixa de ser pendência. A trilha B do plano de continuidade permanece bloqueada por falta de host separado.

| Prioridade | Fase | Pendência | Responsável funcional | Evidência de fechamento |
|---|---:|---|---|---|
| Alta | 045 | Corte app↔banco com sete votos HTTP 503, recibos/auditoria e prontidão 200→503→200 provados localmente; sonda registra transições degradado/recuperado com `incidentId` em teste local | Engenharia de plataforma | Mesmo ensaio em vários nós; instalar sonda e coletor de eventos em host externo e provar alerta correlacionado |
| Alta | 045 | Matriz local de cinco cenários com leitura pública e voto contínuos, sete votos/recibos/auditorias por cenário, outbox zerada e cadeia válida; sem observador externo nem reinício de host | Engenharia de plataforma | Repetir com carga representativa, observador fora do host e reinício real da máquina |
| Média | 045 | Retenção dos backups locais de `db/` (simulada e conferida; 19 arquivos, 19,1 MB) | Operação SaaS | `db:backup:prune --apply` executado com os rótulos citados em documento protegidos por `--keep-pattern` |
| Alta | 044 | Arquivos de foto/emblema e mídia sobreviverem a troca de instância/restauração | Operação SaaS | Inventário sem ausências, snapshot dos diretórios, restore em ambiente descartável e hashes iguais |
| Alta | 045 | Restore conjunto local com mídia referenciada e segunda instância do app: bootstrap, login e 52 sessões autenticadas; leases e rate limit já ensaiados | Engenharia de plataforma | Repetir em host/servidor PostgreSQL isolado, com volume representativo, RTO/RPO medidos e runbook operacional |
| Média | 045 | Versão exposta localmente; falta confirmar revisão implantada no host de homologação | Engenharia de plataforma | `STAGE_BUILD_VERSION` definido por build, sonda externa registrando a mesma revisão em app, realtime, webhooks e scheduler |
| Bloqueante | 046 | Regimento, composição e papéis oficiais por Câmara — formulários prontos em [`aceite/`](aceite/README.md), aguardando preenchimento e assinatura | Secretaria legislativa e Presidência da Câmara | Matriz de casos e configuração versionada aprovadas |
| Alta | 047 | Convocação com prova de entrega/ciência e documentos versionados | Secretaria legislativa | Jornada e comprovantes de envio revisados |
| Alta | 048–049 | Quórum por ato, identificação e apuração nominal/simbólica | Mesa e secretaria | Sessões simuladas, conferência humana e testes concorrentes |
| Bloqueante para modalidade | 050 | Sigilo real do voto secreto e continuidade offline | Segurança e Mesa | Revisão independente; modalidade desabilitada até aceite |
| Alta | 051 | Ata, assinaturas, portal e retificação por novo ato | Jurídico/secretaria | Documentos e publicação aprovados |
| Alta | 052 | Redes sociais com canal institucional, imagem/áudio observados externamente | Audiovisual da Câmara | Sessão privada, falha/retorno, gravação e replay íntegros |
| Alta | 053 | Piloto Mucuri, acessibilidade e treinamento | Câmara e operação SaaS | Termos de aceite técnico, legislativo e audiovisual |
| Alta | 048–049 | Carga concorrente **medida localmente** ([etapa](etapas/045-carga-jornada-telao.md)); falta repetir fora do host, com observador externo | Engenharia de plataforma | Mesma medição em host separado, com observador fora do host medido e acordo de relógio |
| Final | 054–056 | Nextcloud/Alfresco: leitura, reconciliação e escrita autorizada | TI institucional e engenharia | Identidades externas, versões/hashes, retry e reversão ensaiados |
