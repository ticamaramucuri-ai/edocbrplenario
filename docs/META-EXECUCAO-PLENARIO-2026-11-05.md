# Meta de execução — edocBR Plenário

**Início:** 05/11/2026. **Referência:** [plano de desenvolvimento corrente](PLANO-DESENVOLVIMENTO-ATUAL-2026-11-05.md). **Estado:** em execução. O objetivo é entregar um SaaS de plenário reproduzível para outras Câmaras, ensaiar o piloto de Mucuri com responsáveis institucionais e, depois dele, integrar o fluxo edocBR. Uma prova local não constitui autorização para ato oficial.

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
| M1 — acervo e recuperação | Banco, foto, PDF e replay ensaiados localmente | Restaurar banco e arquivos juntos; servir foto e documento por HTTP com hash íntegro; provar isolamento, adulteração e ausência; ensaiar replay e medir recuperação | Volume/host separado para RTO/RPO e prova operacional final |
| M2 — deliberação confiável | Livro de papel e duas instâncias PostgreSQL ensaiados localmente | Casos fictícios de presença, suplência, impedimento, empate, votação nominal/simbólica e anulação; resultado esperado calculado independentemente do serviço; relatório e ata conciliados; cruzamento de tenant recusado | Matriz regimental, host externo e aceite institucional |
| M3 — audiovisual em laboratório | Ensaio sintético repetido | Dois destinos simulados, vídeo e áudio, perda/retorno de um destino, gravação/replay sob carga de sessão; portal só exibe link conferido; deliberação segue independente da mídia | Equipamentos, canal e observador externos para homologação |
| M4 — pacote de homologação | Roteiro preparado | Implantação parametrizada, checklist por papel, comandos de diagnóstico, roteiro de ensaio longo e matriz de evidências/aceites | Host, responsáveis e contas institucionais para execução |
| M5 — fases 045–053, piloto | Incrementos técnicos existentes; sem homologação | Implantação SaaS em host separado; política e composição aprovadas; sessão, pauta, convocação, presença, votação, ata, transparência e transmissão ensaiadas e aceitas pela Câmara; pré-voo pronto | TI, secretaria, Presidência, jurídico e audiovisual |
| M6 — fases 054–056, integração | Planejado após M5 | Definir fonte de verdade e autoridade; conectores de leitura Nextcloud/Alfresco; publicação por outbox com ACK, hash, deduplicação, reconciliação e reversão; testes de ACL e tenant | Piloto aceito e contratos de integração aprovados |
| M7 — fase 057, expansão SaaS | Planejado | Onboarding repetível, suporte, atualização por tenant, monitoramento, restauração periódica e critérios operacionais aceitos | Métricas e contrato de operação acordados |

**Conclusão da meta:** M0–M7 demonstrados com evidências vinculadas, testes relevantes aprovados e aceites explícitos onde exigidos. O voto secreto oficial e a votação offline seguem fora do piloto; eventual inclusão requer projeto e revisão próprios.

## Sequência imediata sem dependências institucionais

- [x] Regressão de layout e jornada de ata pública em navegador fictício.
- [x] Imagem restaurada por HTTP e pré-voo de referências locais por Câmara.
- [x] Conferência deliberativa independente com dados fictícios (M2, incremento local).
- [x] Transmissão com dois destinos simulados e replay sob carga (M3, ensaio sintético).
- [x] Pacote de execução documental de homologação (M4, preparação local).

Os cinco itens acima são incrementos locais: foto, PDF e replay foram restaurados em instância descartável; a votação nominal foi conferida em duas instâncias PostgreSQL do mesmo host. Host separado, matriz regimental, canal social e aceite institucional continuam em aberto nos marcos correspondentes. A execução de **M5** requer essas entradas institucionais; os ensaios técnicos locais ainda podem ampliar falhas, recuperação e simbólica oficial. As integrações Nextcloud/Alfresco começam em **M6**, após o piloto.
