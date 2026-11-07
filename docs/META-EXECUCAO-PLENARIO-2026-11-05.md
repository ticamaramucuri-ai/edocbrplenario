# Meta de execução — edocBR Plenário

**Início:** 05/11/2026. **Atualização:** 07/11/2026. **Referência:** [plano de desenvolvimento corrente](PLANO-DESENVOLVIMENTO-ATUAL-2026-11-05.md). **Estado:** em execução. A staging sintética está ativa na VPS dedicada e a primeira promoção passou pela CI; o piloto institucional não está homologado. O objetivo é entregar um SaaS de plenário reproduzível para outras Câmaras, ensaiar o piloto de Mucuri com responsáveis institucionais e, depois dele, integrar o fluxo edocBR. Uma prova local ou em staging não constitui autorização para ato oficial.

## Regras de execução

1. Executar os marcos na ordem abaixo. Trabalho independente pode avançar enquanto uma dependência externa aguarda, sem antecipar o aceite do marco dependente.
2. Para cada incremento: registrar mudança, comando de prova, resultado, riscos e próxima ação em `docs/etapas/`; atualizar o plano e a matriz quando o estado mudar.
3. Usar dados e contas fictícios em ensaios locais. Mucuri só recebe regra, usuário, canal e documento oficial após conferência e autorização dos responsáveis.
4. Distinguir **implementado** (código e teste), **ensaiado** (jornada em ambiente controlado) e **homologado** (prova no ambiente alvo com aceite identificado).
5. Não concluir a meta por ausência de host, contas ou aceite. Registrar a dependência e continuar apenas o trabalho local que for verificável.

## Marcos e critérios de saída

| Marco | Estado em 05/11 | Entrega e prova exigida | Dependência para conclusão |
|---|---|---|---|
| M0 — base e jornada SaaS | Ensaiado localmente em partes | Layout desktop/móvel; criação de sessão, pauta, votação, ata e portal em jornada reproduzível; papéis e tenants separados; CI coerente com o plano | Revisão visual humana e fechamento das lacunas da jornada |
| M1 — acervo e recuperação | Banco, foto, PDF e replay ensaiados localmente; snapshot e restauração sintéticos executados na VPS; app autenticado restaurado e hash/replay conferidos; pacote cifrado transferido e banco + mídia restaurados em computador independente | Implantar backup recorrente cifrado com retenção e alerta; restaurar app completo em host independente; medir RTO/RPO e testar falha global representativa | Destino independente durável, RTO/RPO pactuados e restauração operacional observada |
| M2 — deliberação confiável | Livro de papel e duas instâncias PostgreSQL ensaiados localmente | Casos fictícios de presença, suplência, impedimento, empate, votação nominal/simbólica e anulação; resultado esperado calculado independentemente do serviço; relatório e ata conciliados; cruzamento de tenant recusado | Matriz regimental, host externo e aceite institucional |
| M3 — audiovisual em laboratório | Ensaio sintético repetido | Dois destinos simulados, vídeo e áudio, perda/retorno de um destino, gravação/replay sob carga de sessão; portal só exibe link conferido; deliberação segue independente da mídia | Equipamentos, canal e observador externos para homologação |
| M4 — pacote de homologação | Roteiro preparado; VPS HTTPS ativa; commits `ceb8858`, `9ae0e77` e `b8d137e` promovidos após CI verde; observador externo aprovado; recuperação sintética e workers ensaiados na VPS; banco e mídia restaurados fora do host | Acompanhar histórico agendado, definir alerta, coleta autenticada dos cinco serviços fora da VPS, backup recorrente, app restaurado em host independente, ensaio longo e matriz de falhas | Histórico prolongado, política de alerta e recuperação operacional independente medida; responsáveis e contas institucionais permanecem necessários para aceite |
| M5 — fases 045–053, piloto | Incrementos técnicos existentes; sem homologação | Implantação SaaS em host separado; política e composição aprovadas; sessão, pauta, convocação, presença, votação, ata, transparência e transmissão ensaiadas e aceitas pela Câmara; pré-voo pronto | TI, secretaria, Presidência, jurídico e audiovisual |
| M6 — fases 054–056, integração | Planejado após M5 | Definir fonte de verdade e autoridade; conectores de leitura Nextcloud/Alfresco; publicação por outbox com ACK, hash, deduplicação, reconciliação e reversão; testes de ACL e tenant | Piloto aceito e contratos de integração aprovados |
| M7 — fase 057, expansão SaaS | Planejado | Onboarding repetível, suporte, atualização por tenant, monitoramento, restauração periódica e critérios operacionais aceitos | Métricas e contrato de operação acordados |

**Conclusão da meta:** M0–M7 demonstrados com evidências vinculadas, testes relevantes aprovados e aceites explícitos onde exigidos. O voto secreto oficial segue fora do piloto. A votação offline está desabilitada hoje; o usuário definiu o desktop servidor por Câmara e a sincronização automática como direção do produto. Ainda falta decidir se essa capacidade será gate do primeiro piloto ou entrega posterior. Qualquer uso oficial offline exige a nova trilha técnica e revisão institucional da fase 050.

**Nova trilha de arquitetura:** todas as sessões e documentos de preparação são cadastrados no SaaS web e importados com versão e hash pelo app desktop Windows/Linux da Câmara. O desktop serve sessão, documentos e comandos aos dispositivos na LAN e envia os atos ao SaaS com confirmação e reconciliação. O [ADR-027](adr/ADR-027-saas-nucleo-local-operacao-offline.md) define a sequência de oito entregas e seus gates. Este requisito não transforma os ensaios locais atuais em operação offline homologada nem antecipa Nextcloud/Alfresco.

## Sequência imediata sem dependências institucionais

- [x] Regressão de layout e jornada de ata pública em navegador fictício.
- [x] Imagem restaurada por HTTP e pré-voo de referências locais por Câmara.
- [x] Conferência deliberativa independente com dados fictícios (M2, incremento local).
- [x] Transmissão com dois destinos simulados e replay sob carga (M3, ensaio sintético).
- [x] Pacote de execução documental de homologação (M4, preparação local).
- [x] Preparação da VPS dedicada, domínio HTTPS e promoção do SHA aprovado pelo CI (M4, staging sintética).
- [x] Publicação e primeira execução independente do observador público a cada 15 minutos (M4; run `42390489098` aprovado).
- [x] Restauração sintética de banco + gravação/replay na VPS e recuperação de workers (M1/M4; [evidência](etapas/045-prova-recuperacao-vps-sintetica.json)).

Os itens locais anteriores permanecem ensaios: foto, PDF e replay foram restaurados em instância descartável; votações fictícias foram conferidas em laboratório. A VPS e HTTPS estão ativas; a recuperação sintética no mesmo host restaurou banco + arquivos em alvos descartáveis e um app autenticado, sem substituir a base ativa. Uma transferência cifrada posterior restaurou banco + arquivos em outro computador, mas não houve backup recorrente nem app restaurado nesse host, portanto não foi medida recuperação operacional contra perda da VPS nem RTO/RPO oficial. A [prova de deliberação](etapas/049-deliberacao-postgres-duas-instancias.md) reconciliou banco, auditoria, ata e portal. Matriz regimental, canal social e aceite institucional continuam em aberto. A execução de **M5** requer essas entradas institucionais; **045/M4** segue com recuperação e monitoramento externos. As integrações Nextcloud/Alfresco começam em **M6**, após o piloto.
