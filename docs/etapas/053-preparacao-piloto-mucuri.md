# Etapa 053 — Preparação do piloto assistido de Mucuri

**Data:** 11/10/2026 · **Estado:** roteiro e critérios de aceite preparados; piloto institucional não iniciado.

**Pré-voo automatizado:** `DATABASE_URL=file:../db/custom.db bun run pilot:preflight --tenant=camara-mucuri-ba` consulta apenas a Câmara indicada, sem alterar dados. O JSON diferencia verificações automáticas de evidências institucionais; termina com código 2 se houver bloqueios. O ensaio de 11/10/2026 encontrou Mucuri ativa, mas sem legislatura/mandatos/Mesa/regras aprovadas, sem usuários nos papéis de operação, com a base local SQLite, sem SMTP configurado e sem destino social público configurado. Não há sessão oficial cadastrada. O relatório **nunca** transforma verificação técnica em aceite da Câmara. `bun run test:pilot:preflight` prova isolamento entre duas Câmaras e ausência de dados pessoais na saída.

**Rechecagem em 13/10/2026:** o pré-voo somente leitura repetiu os mesmos bloqueios: `automaticReady: false`, Câmara ativa, configuração incompleta/sem aprovação, zero usuários nos papéis de administração/Mesa/mídia, SQLite local, SMTP não configurado, zero destinos sociais e zero sessões oficiais. O código de saída 2 é o resultado esperado enquanto o piloto está bloqueado.

Esta etapa não cadastra vereadores, regras, atas nem sessões oficiais presumidos. O primeiro ensaio usa uma Câmara de teste e dados fictícios. A Câmara Municipal de Mucuri/BA só entra no piloto oficial depois de conferir e aprovar suas próprias informações, responsáveis e procedimentos.

## Critérios de entrada

1. Responsável legislativo confere legislatura, mandatos, suplência, partidos, Mesa, tipos de sessão, prazos, quórum, maioria, impedimentos, convocação, votação simbólica e textos da ata. Registrar a referência e a versão aprovadas no sistema; comparar casos reais anonimizados com apuração independente.
2. Responsável técnico comprova PostgreSQL persistente, serviços auxiliares, domínio/TLS, relógio, armazenamento durável de imagens e mídia, backup conjunto e restauração medida. Definir RTO/RPO, retenção, alertas e procedimento de suspensão. A fase 045 permanece aberta até essa prova.
3. Responsável audiovisual confere câmeras, mesa de áudio, encoder, energia, banda, canal institucional, URL pública, gravação e replay. Executar o [roteiro da fase 052](052-transmissao-social-assistida.md) em página externa e registrar quem observou e quem publicou.
4. Responsável de acesso cria usuários nominais por papel, valida MFA onde aplicável, revê permissões de operador/parlamentar/publicador e evita contas compartilhadas. Convocação por canal externo exige prova de envio e ciência; a declaração manual da fase 047 não a substitui.
5. Equipe de operação confirma o que fazer quando fonte, rede, banco, worker ou telão falhar. Voto secreto oficial e votação offline permanecem desabilitados; não incluí-los no roteiro como função disponível.

## Sequência de ensaio e aceite

| Passo | Ação com dados fictícios | Evidência de saída |
|---|---|---|
| 1 | Criar Câmara de ensaio e dois perfis de operação; aprovar configuração versionada | Hash/referência da configuração, permissões e isolamento entre Câmaras |
| 2 | Preparar sessão, anexar documentos, publicar pauta e registrar convocação | Revisões, hashes, destinatários e horário de cada ato |
| 3 | Abrir sessão, registrar presença, suplência/impedimento e fala; reiniciar painel/telão | Quórum conferido, comandos sem duplicação e estado recomposto |
| 4 | Votar matérias nominais e simbólicas, incluir empate/ausência/correção previstos pela regra aprovada | Comparação assinada entre contagem do sistema e conferência manual; recibos e auditoria |
| 5 | Transmitir e gravar, perder sinal e recuperar; conferir página social em outra rede | Observações separadas por destino, horários, vídeo/áudio, falha/retorno e hash do replay |
| 6 | Encerrar, gerar minuta, revisar, assinar, publicar por outra pessoa e conferir portal | Ata e vídeo vinculados à sessão, código público, hashes e verificação externa |
| 7 | Executar backup, restaurar em ambiente isolado e repetir leituras críticas | Inventário banco+arquivos, tempo medido, divergências e decisão de recuperação |
| 8 | Ensaiar teclado/leitor de tela e orientar Mesa, secretaria, operadores de mídia e suporte | Registro de achados, correções, responsáveis e aceite por área |

Após o ensaio fictício, fazer uma sessão simulada longa com a equipe real. Só então selecionar uma sessão assistida real, com plano de suspensão e conferência humana antes de cada ato irreversível. Em cada rodada registrar data, versão implantada, participantes, incidente, correção, evidência e aceite legislativo, técnico e audiovisual. Uma falha bloqueante mantém o piloto suspenso até nova prova do passo afetado.

**Saída da fase:** aceite expresso da Câmara sobre regras, apuração, ata, transmissão, acesso, operação e recuperação. Sem isso, o estado permanece “piloto não homologado”. Nextcloud e Alfresco entram somente após esse aceite, nas fases 054–056.
